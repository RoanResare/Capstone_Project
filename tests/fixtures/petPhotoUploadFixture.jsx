import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PetPhotoUpload } from "../../src/app/components/PetPhotoUpload.jsx";
import "../../src/styles/index.css";

function Fixture() {
  const [photoURL, setPhotoURL] = useState(() => JSON.parse(localStorage.getItem("pet-fixture-record") || "null")?.photoURL || "");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [saved, setSaved] = useState(false);
  const toast = { error() {} };
  return <main className="@container mx-auto min-w-0 max-w-4xl rounded-3xl bg-white p-4 shadow-xl sm:p-8">
    <div className="grid min-w-0 gap-5 @min-[32rem]:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] @min-[48rem]:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
    <form className="box-border w-full min-w-0 max-w-[28rem] space-y-3 [&_input:not([type=file])]:box-border [&_input:not([type=file])]:w-full [&_input:not([type=file])]:max-w-full [&_input:not([type=file])]:min-w-0 [&_select]:box-border [&_select]:w-full [&_select]:max-w-full [&_select]:min-w-0 [&_textarea]:box-border [&_textarea]:w-full [&_textarea]:max-w-full [&_textarea]:min-w-0" onSubmit={event => { event.preventDefault(); localStorage.setItem("pet-fixture-record", JSON.stringify({ petName: "Milo", photoURL })); setSaved(true); }}>
      <label className="block text-sm font-semibold">Pet name<input aria-label="Pet name" className="mt-2 block rounded-xl border p-3" defaultValue="Milo"/></label>
      <select aria-label="Pet type" className="rounded-xl border p-3"><option>Dog</option></select>
      <textarea aria-label="Pet notes" className="rounded-xl border p-3" defaultValue="Friendly pet"/>
      <PetPhotoUpload photoURL={photoURL} petName="Milo" onPhotoChange={setPhotoURL} toast={toast} setFeedback={setFeedback}/>
      {feedback.message && <p role="alert" className="mt-3 text-sm text-red-700">{feedback.message}</p>}
      <button type="submit" className="mt-4 rounded-xl bg-[#173E44] px-5 py-3 font-semibold text-white">Save changes</button>
      <output aria-live="polite" className="ml-3">{saved ? (photoURL ? "saved-with-photo" : "saved-without-photo") : localStorage.getItem("pet-fixture-record") ? "loaded-saved-pet" : "not-saved"}</output>
    </form>
    <aside className="min-w-0 rounded-xl bg-slate-50 p-4">Saved pets</aside>
    </div>
  </main>;
}

createRoot(document.getElementById("root")).render(<Fixture/>);
