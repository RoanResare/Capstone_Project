import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PetPhotoUpload } from "../../src/app/components/PetPhotoUpload.jsx";
import "../../src/styles/index.css";

function Fixture() {
  const [photoURL, setPhotoURL] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [saved, setSaved] = useState(false);
  const toast = { error() {} };
  return <main className="mx-auto max-w-xl rounded-3xl bg-white p-5 shadow-xl sm:p-8">
    <form onSubmit={event => { event.preventDefault(); setSaved(true); }}>
      <label className="mb-3 block text-sm font-semibold">Pet name<input aria-label="Pet name" className="mt-2 block w-full rounded-xl border p-3" defaultValue="Milo"/></label>
      <PetPhotoUpload photoURL={photoURL} petName="Milo" onPhotoChange={setPhotoURL} toast={toast} setFeedback={setFeedback}/>
      {feedback.message && <p role="alert" className="mt-3 text-sm text-red-700">{feedback.message}</p>}
      <button type="submit" className="mt-4 rounded-xl bg-[#173E44] px-5 py-3 font-semibold text-white">Save pet</button>
      <output aria-live="polite" className="ml-3">{saved ? (photoURL ? "saved-with-photo" : "saved-without-photo") : "not-saved"}</output>
    </form>
  </main>;
}

createRoot(document.getElementById("root")).render(<Fixture/>);
