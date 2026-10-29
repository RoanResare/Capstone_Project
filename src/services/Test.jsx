import { useState } from "react";
import { askGroq } from "./services/groq";

export default function Test() {
  const [reply, setReply] = useState("");

  const testAI = async () => {
    const response = await askGroq(
      "What are your grooming services?"
    );

    console.log(response);

    setReply(response);
  };

  return (
    <div className="p-10">
      <button
        onClick={testAI}
        className="bg-blue-500 text-white px-5 py-2 rounded"
      >
        Test AI
      </button>

      <p className="mt-5">{reply}</p>
    </div>
  );
}