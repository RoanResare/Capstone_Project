import { RouterProvider } from "react-router-dom";
import { router } from "./routes.jsx";
import { AppProvider } from "./context/AppContext.jsx";

// IMPORT GROQ TEST
import { askGroq } from "./services/groq";

export default function App() {

  // TEST FUNCTION
  const testGroqAI = async () => {
    await askGroq();
  };

  return (
    <AppProvider>

      {/* TEST BUTTON */}
      <div style={{ padding: "10px" }}>
        <button
          onClick={testGroqAI}
          style={{
            backgroundColor: "blue",
            color: "white",
            padding: "10px 20px",
            borderRadius: "5px",
            border: "none",
            cursor: "pointer",
            marginBottom: "10px"
          }}
        >
          TEST GROQ AI
        </button>
      </div>

      {/* ORIGINAL ROUTER */}
      <RouterProvider router={router} />

    </AppProvider>
  );
}