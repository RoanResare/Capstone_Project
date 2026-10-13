import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function seedDatabase() {
  try {
    console.log("Starting database seeding for Charming Fur-Fection Pet Care Services...");

    const serviceAccount = require("./serviceAccountKey.json");

    initializeApp({
      credential: cert(serviceAccount),
    });

    const db = getFirestore();
    const batch = db.batch();
    const servicesRef = db.collection("services");

    // Stable document IDs prevent duplicate services when the script is rerun.
    // Rerunning replaces these documents and refreshes their timestamps.
    batch.set(servicesRef.doc("grooming-basic"), {
      name: "Basic Pet Grooming",
      description: "Includes haircut, bath, nail trimming, and ear cleaning.",
      price: 500,
      duration: "1 hour",
      createdAt: FieldValue.serverTimestamp(),
    });

    batch.set(servicesRef.doc("boarding-full"), {
      name: "Full-Day Pet Boarding",
      description: "Safe and comfortable cage-free boarding with meals and playtime.",
      price: 800,
      duration: "24 hours",
      createdAt: FieldValue.serverTimestamp(),
    });

    batch.set(db.collection("slot_management").doc("settings"), {
      maxSlotsPerDay: 10,
      isBookingOpen: true,
      businessEmail: "charmingfurfectionpetcare2@gmail.com",
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Commit all seed documents together to avoid partially seeded data.
    await batch.commit();

    console.log("Successfully seeded services: grooming-basic and boarding-full.");
    console.log("Successfully seeded slot_management/settings.");
    console.log("Database seeding completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Database seeding failed:", error);
    process.exit(1);
  }
}

seedDatabase();
