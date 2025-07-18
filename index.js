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

    const mealCollection = client.db("MealMateDB").collection("meals");

    // POST: Add a new meal
    app.post("/meals", async (req, res) => {
      try {
        const meal = req.body; // meal object from frontend
        const result = await mealCollection.insertOne(meal);
        res.send(result);
      } catch (error) {
        console.error("Error adding meal:", error);
        res.status(500).send({ error: "Failed to add meal" });
      }
    });

    // GET: All meals or meals by user email (latest first)
    app.get("/meals", async (req, res) => {
      try {
        const email = req.query.email;
        const filter = email
          ? {
              distributorEmail: email,
            }
          : {};

        const meals = await mealCollection
          .find(filter)
          .sort({ postTime: -1 }) // Sort by postTime descending
          .toArray();

        res.send(meals);
      } catch (error) {
        console.error("Error fetching meals:", error);
        res.status(500).send({ error: "Failed to fetch meals" });
      }
    });

    // GET: Meal by ID
    app.get("/meals/:id", async (req, res) => {
      try {
        const id = req.params.id;

        // Check for valid ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ error: "Invalid meal ID" });
        }

        const query = { _id: new ObjectId(id) };
        const meal = await mealCollection.findOne(query);

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

      const result = await mealCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { likes: 1 } }
      );

      res.send(result);
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
