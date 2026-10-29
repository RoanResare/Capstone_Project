import axios from "axios";

// GET API KEY FROM .ENV
const API_KEY = import.meta.env.VITE_GROQ_API_KEY;

// FUNCTION TO ASK AI
export const askGroq = async (message) => {
  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",

      {
        model: "llama3-70b-8192",

        messages: [
          {
            role: "system",

            content: `
You are the official AI assistant of Charming Fur-fection Pet Care Services.

Only answer questions related to:
- pet grooming
- appointments
- pet care
- veterinary services
- schedules
- branch information

Rules:
- Be friendly and professional.
- Keep answers short and clear.
- Reject unrelated questions.
- If unsure, recommend contacting staff.
`,
          },

          {
            role: "user",
            content: message,
          },
        ],
      },

      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    // RETURN AI RESPONSE
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("GROQ ERROR:", error);

    return "AI is currently unavailable.";
  }
};