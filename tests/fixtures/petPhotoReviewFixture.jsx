import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PetPhotoDialog, PetPhotoThumbnail, resolveAppointmentPetPhoto } from "../../src/app/components/portal/PetPhotoDisplay.jsx";
import "../../src/styles/index.css";

const pets = [
  { id: "pet-a", petName: "Ayla", photoURL: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%23d86b52'/%3E%3C/svg%3E" },
  { id: "pet-b", petName: "Betty", photoURL: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%234f91a0'/%3E%3C/svg%3E" },
  { id: "pet-c", petName: "Coco", photoURL: "" },
];
const appointment = { petRecordId: "pet-b", petName: "Betty" };

function Fixture() {
  const [view, setView] = useState(null);
  const associatedPet = resolveAppointmentPetPhoto(pets, appointment);
  const missingPet = resolveAppointmentPetPhoto(pets, { petRecordId: "removed-pet", petName: "Ayla" });
  return <main className="mx-auto grid max-w-3xl gap-4 rounded-3xl bg-white p-5 shadow-xl sm:grid-cols-2 sm:p-8">
    <section aria-label="Manage pet records"><h1 className="text-lg font-semibold">Manage Pet Records</h1>
      {pets.map(pet => <div key={pet.id} className="mt-3 flex items-center gap-3 rounded-xl border p-3">
        <PetPhotoThumbnail photoURL={pet.photoURL} name={pet.petName} onOpen={() => setView(pet)}/><span>{pet.petName}</span>
      </div>)}
    </section>
    <section aria-label="Appointment details"><h2 className="text-lg font-semibold">Appointment details</h2>
      <p className="mt-3">Associated pet: {associatedPet.petName}</p>
      <PetPhotoThumbnail photoURL={associatedPet.photoURL} name={associatedPet.petName} size="large" onOpen={() => setView(associatedPet)}/>
      <p data-testid="missing-link">Missing linked record: {missingPet?.petName || "none"}</p>
      {view && <PetPhotoDialog photo={view.photoURL} name={view.petName} onClose={() => setView(null)}/>}
    </section>
  </main>;
}

createRoot(document.getElementById("root")).render(<Fixture/>);
