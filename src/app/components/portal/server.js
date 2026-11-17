const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

app.post("/chat", async (req, res) => {

  try {

    const response = await axios.post(
      "http://localhost:11434/api/generate",
      {
        model: "llama3",
        prompt: req.body.message,
        stream: false
      }
    );

    res.json({
      reply: response.data.response
    });

  } catch (error) {

    console.log(error);

    res.status(500).json({
      error: "AI Error"
    });

  }

});

app.listen(5000, () => {
  console.log("Server running");
});
