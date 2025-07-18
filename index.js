// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// Middleware
app.use(cors());
app.use(express.json()); // to parse JSON body

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
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const mealsCollection = client.db("MealMateDB").collection("meals");
    const mealReviewsCollection = client
      .db("MealMateDB")
      .collection("mealReview");
    const mealRequestCollection = client
      .db("MealMateDB")
      .collection("mealRequest");

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

        // Filter by email if present
        if (email) {
          filter.distributorEmail = email;
        }

        // Search by title (case-insensitive)
        if (search) {
          filter.title = { $regex: search, $options: "i" };
        }

        // Category filter
        if (category !== "All") {
          filter.category = { $regex: `^${category}$`, $options: "i" }; 
        }

        // Price range filter
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
          .sort({ postTime: -1 }) // Use postTime for sorting
          .toArray();

        res.send(meals);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch meals" });
      }
    });

    // //get meals with search functionality
    // app.get("/meals", async (req, res) => {
    //   try {
    //     const { search = "", category = "All", priceRange = "All" } = req.query;

    //     const filter = {};

    //     // Search by title (case-insensitive)
    //     if (search) {
    //       filter.title = { $regex: search, $options: "i" };
    //     }

    //     // Category filter
    //     if (category !== "All") {
    //       filter.category = category;
    //     }

    //     // Price range filter
    //     if (priceRange !== "All") {
    //       if (priceRange === "301+") {
    //         filter.price = { $gte: 301 };
    //       } else {
    //         const [min, max] = priceRange.split("-").map(Number);
    //         filter.price = { $gte: min, $lte: max };
    //       }
    //     }

    //     const meals = await mealsCollection
    //       .find(filter)
    //       .sort({ createdAt: -1 }) // latest first
    //       .toArray();

    //     res.send(meals);
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).send({ message: "Failed to fetch meals" });
    //   }
    // });

    // GET: Meal by ID
    app.get("/meals/:id", async (req, res) => {
      try {
        const id = req.params.id;

        // Check for valid ObjectId
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

      // Optionally update review count in meals collection
      await mealsCollection.updateOne(
        { _id: new ObjectId(review.mealId) },
        { $inc: { reviews_count: 1 } }
      );

      res.send(insertResult);
    });

    //get meals review
    app.get("/reviews/:mealId", async (req, res) => {
      const mealId = req.params.mealId;

      const reviews = await mealReviewsCollection
        .find({ mealId: mealId })
        .sort({ createdAt: -1 }) // latest first
        .toArray();

      res.send(reviews);
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
