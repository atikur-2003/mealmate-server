const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 5000;
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

// Middleware
app.use(cors());
app.use(express.json());

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

const decodedKey = Buffer.from(process.env.FB_ADMIN_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decodedKey);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.g93sy5b.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();

    const db = client.db("MealMateDB");
    const mealsCollection = db.collection("meals");
    const usersCollection = db.collection("users");
    const mealReviewsCollection = db.collection("mealReview");
    const mealRequestCollection = db.collection("mealRequest");
    const paymentsCollection = db.collection("payments");

    //custom middleware
    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = authHeader.split(' ')[1];
      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      //verify token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: "forbidden access" });
      }
    };

    const verifyAdmin = async(req, res, next)=>{
      const email = req.decoded.email;
      const query = {email};
      const user = await usersCollection.findOne(query);
      if(!user || user.role !=='admin'){
        return res.status(403).send({message: "forbidden access"})
      }
      next();
    }

    //user post api
    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const userExists = await usersCollection.findOne({ email });
      if (userExists) {
        return res
          .status(200)
          .send({ message: "user already exists", inserted: false });
      }
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // GET /users/role/:email
    app.get("/users/role/:email",verifyFBToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({
        email: { $regex: `^${email}$`, $options: "i" },
      });

      if (!user) {
        return res.status(404).send({ role: null });
      }

      res.send({ role: user.role });
    });

    // GET: Search user by email
    app.get("/users/search",verifyFBToken, async (req, res) => {
      const email = req.query.email;
      if (!email)
        return res.status(400).send({ error: "Email query is required" });

      const regex = new RegExp(email, "i");

      try {
        const users = await usersCollection
          .find({ email: { $regex: regex } })
          .project({ email: 1, createdAt: 1, role: 1 })
          .limit(10)
          .toArray();

        res.send(users);
      } catch (error) {
        console.error("Error searching user:", error);
        res.status(500).send({ error: "Failed to search user" });
      }
    });

    // PATCH: Make or remove user an admin
    app.patch("/users/:id/role",verifyFBToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;
      if (!["admin", "user"].includes(role)) {
        return res.status(400).send({ message: "Invalid role" });
      }
      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );
        res.send({ message: `User role updated to ${role}`, result });
      } catch (error) {
        console.error("Error updating user role", error);
        res.status(500).send({ message: "Failed to update user role" });
      }
    });

    // POST: Add a new meal
    app.post("/meals", async (req, res) => {
      try {
        const meal = req.body; // meal object from frontend
        const result = await mealsCollection.insertOne(meal);
        res.send(result);
      } catch (error) {
        console.error("Error adding meal:", error);
        res.status(500).send({ error: "Failed to add meal" });
      }
    });

    // GET: All meals or meals by user email (latest first)
    app.get("/meals", verifyFBToken, async (req, res) => {
      try {
        const {
          email,
          search = "",
          category = "All",
          priceRange = "All",
        } = req.query;

        const filter = {};

        if (email) {
          filter.distributorEmail = email;
        }

        if (search) {
          filter.title = { $regex: search, $options: "i" };
        }

        if (category !== "All") {
          filter.category = { $regex: `^${category}$`, $options: "i" };
        }

        if (priceRange !== "All") {
          if (priceRange === "301+") {
            filter.price = { $gte: 301 };
          } else {
            const [min, max] = priceRange.split("-").map(Number);
            filter.price = { $gte: min, $lte: max };
          }
        }

        const meals = await mealsCollection
          .find(filter)
          .sort({ postTime: -1 })
          .toArray();

        res.send(meals);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch meals" });
      }
    });

    // GET: Meal by ID
    app.get("/meals/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ error: "Invalid meal ID" });
        }

        const query = { _id: new ObjectId(id) };
        const meal = await mealsCollection.findOne(query);

        if (!meal) {
          return res.status(404).send({ error: "Meal not found" });
        }

        res.send(meal);
      } catch (error) {
        console.error("Error fetching meal by ID:", error);
        res.status(500).send({ error: "Failed to fetch meal" });
      }
    });

    //get upcoming meal
    app.get("/upcoming-meals", verifyFBToken, async (req, res) => {
      try {
        const now = new Date();

        const upcomingMeals = await mealsCollection
          .find({ postTime: { $gt: now.toISOString() } })
          .sort({ postTime: 1 })
          .toArray();

        res.send(upcomingMeals);
      } catch (err) {
        console.error("Error fetching upcoming meals:", err);
        res.status(500).send({ error: "Failed to fetch upcoming meals" });
      }
    });

    //upcoming meal like
    app.patch("/meals/:id/like", async (req, res) => {
      const { id } = req.params;

      try {
        const result = await mealsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $inc: { likes: 1 } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: "Meal not found" });
        }

        res.send({ message: "Meal liked successfully", result });
      } catch (error) {
        console.error("Error liking meal:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    //meal like api
    app.post("/meals/like/:id", async (req, res) => {
      const id = req.params.id;

      const result = await mealsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { likes: 1 } }
      );

      res.send(result);
    });

    //post meal request
    app.post("/meal-requests", async (req, res) => {
      const mealRequest = req.body;

      const result = await mealRequestCollection.insertOne(mealRequest);
      res.send(result);
    });

    // Get meals requested by email
    app.get("/requested-meals",verifyFBToken, async (req, res) => {
      const { email, search } = req.query;

      const query = {};

      if (email) {
        query.requestedBy = email;
      }

      if (search) {
        query.$or = [
          { userEmail: { $regex: search, $options: "i" } },
          { userName: { $regex: search, $options: "i" } },
        ];
      }

      try {
        const meals = await mealRequestCollection.find(query).toArray();
        res.send(meals);
      } catch (error) {
        console.error("Error fetching requested meals:", error);
        res.status(500).send({ error: "Failed to fetch requested meals" });
      }
    });

    //serve meal
    app.patch("/requested-meals/:id",verifyFBToken, async (req, res) => {
      const { id } = req.params;

      try {
        const result = await mealRequestCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "delivered" } }
        );

        if (result.modifiedCount === 1) {
          res.send({
            message: "Meal status updated to 'served'",
            success: true,
          });
        } else {
          res.status(404).send({ message: "Meal not found or already served" });
        }
      } catch (error) {
        console.error("Error updating meal status:", error);
        res.status(500).send({ error: "Failed to serve meal" });
      }
    });

    // Delete requested meal
    app.delete("/requested-meals/:id", async (req, res) => {
      const id = req.params.id;
      const result = await mealRequestCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    //meal review post api
    app.post("/reviews", async (req, res) => {
      const review = {
        ...req.body,
        createdAt: new Date(),
      };

      const insertResult = await mealReviewsCollection.insertOne(review);

      await mealsCollection.updateOne(
        { _id: new ObjectId(review.mealId) },
        { $inc: { reviews_count: 1 } }
      );

      res.send(insertResult);
    });

    //get all reviews
    app.get("/reviews", async (req, res) => {
      try {
        const reviews = await mealReviewsCollection.find().toArray();
        res.send(reviews);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch reviews" });
      }
    });

    //get meals review by id
    app.get("/reviews/:mealId", async (req, res) => {
      const mealId = req.params.mealId;

      const reviews = await mealReviewsCollection
        .find({ mealId: mealId })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(reviews);
    });

    // Get reviews by user email
    app.get("/reviews", async (req, res) => {
      const email = req.query.email;
      const result = await mealReviewsCollection
        .find({ reviewerEmail: email })
        .toArray();
      res.send(result);
    });

    // POST create payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: price * 100,
        currency: "bdt",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // POST save payment and assign badge
    app.post("/payments", async (req, res) => {
      try {
        const payment = req.body;
        payment.date = new Date(); // Add timestamp to record when it was saved

        const result = await paymentsCollection.insertOne(payment);
        res.send(result);
      } catch (error) {
        console.error("Error saving payment:", error);
        res.status(500).send({ error: "Failed to save payment" });
      }
    });

    // GET: Payments by email
    app.get("/payments",verifyFBToken, async (req, res) => {
      try {
        const email = req.query.email;
        const filter = email ? { email } : {};

        const payments = await paymentsCollection
          .find(filter)
          .sort({ date: -1 })
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).send({ error: "Failed to fetch payment history" });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Example route
app.get("/", (req, res) => {
  res.send("Server is running...");
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
