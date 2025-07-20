const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 5000;
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// Middleware
app.use(cors());
app.use(express.json());

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

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
    await client.connect();

    const db = client.db("MealMateDB");
    const mealsCollection = db.collection("meals");
    const usersCollection = db.collection("users");
    const mealReviewsCollection = db.collection("mealReview");
    const mealRequestCollection = db.collection("mealRequest");
    const paymentsCollection = db.collection("payments");

    app.post('/users', async(req, res)=>{
      const email = req.body.email;
      const userExists = await usersCollection.findOne({email});
      if(userExists){
        return res.status(200).send({message: 'user already exists', inserted: false})
      }
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    })

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
    app.get("/meals", async (req, res) => {
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
    app.get("/meals/:id", async (req, res) => {
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
    app.get("/payments", async (req, res) => {
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
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
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
