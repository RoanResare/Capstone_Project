import { PawPrint } from "lucide-react";

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PET_PHOTO_BYTES = 1024 * 1024;

export function PetPhotoUpload({ photoURL = "", petName = "Pet", onPhotoChange, toast, setFeedback }) {
  async function handleFileChange(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const reportError = (message) => {
      setFeedback?.({ type: "error", message });
      toast?.error(message);
      input.value = "";
    };
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      reportError("Choose a JPG, PNG, or WebP image for the pet photo.");
      return;
    }
    if (file.size > MAX_PET_PHOTO_BYTES) {
      reportError("Pet photo must be 1 MB or smaller.");
      return;
    }
    try {
      const decoded = await createImageBitmap(file);
      const isValid = decoded.width > 0 && decoded.height > 0;
      decoded.close();
      if (!isValid) throw new Error("Invalid dimensions");
      const reader = new FileReader();
      reader.onerror = () => reportError("The selected image could not be read. Please choose another file.");
      reader.onload = () => {
        onPhotoChange(String(reader.result || ""));
        setFeedback?.({ type: "", message: "" });
        input.value = "";
      };
      reader.readAsDataURL(file);
    } catch {
      reportError("The selected image is corrupt or cannot be decoded. Please choose another image.");
    }
  }

  return (
    <section className="grid gap-2 text-sm font-medium text-[#425A60]">
      <h3>Pet Photo (Optional)</h3>
      <p id="pet-photo-help" className="text-xs font-normal leading-5 text-[#607277]">Upload a clear photo of your dog or cat to help our staff identify your pet. JPG, PNG, or WebP, up to 1 MB.</p>
      <label className="group flex min-h-24 cursor-pointer items-center gap-4 rounded-[20px] border border-dashed border-[#9FC9C8] bg-[linear-gradient(145deg,#F8FCFC_0%,#EEF7F6_100%)] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_5px_14px_rgba(45,107,115,0.07)] transition hover:border-[#2D9B9B] hover:shadow-[0_8px_18px_rgba(45,107,115,0.12)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#2D6B73]">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-[#2D6B73] shadow-[0_3px_10px_rgba(30,73,77,0.12)]"><PawPrint size={23}/></span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-[#24444A]">{photoURL ? "Photo ready to save" : "Choose a pet photo"}</span>
          <span className="mt-1 block text-xs font-normal text-[#71878A]">{photoURL ? "Select another image to replace it" : "Select a clear image · JPG, PNG, WebP · Max 1 MB"}</span>
        </span>
        <span className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[#2B555C] shadow-sm group-hover:bg-[#E5F2F1]">{photoURL ? "Replace Photo" : "Browse"}</span>
        <input type="file" aria-label="Pet Photo (Optional)" aria-describedby="pet-photo-help" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} className="sr-only" />
      </label>
      {photoURL ? (
        <div className="rounded-[20px] border border-[#D9E7E7] bg-white p-3 shadow-[0_5px_16px_rgba(30,73,77,0.08)]">
          <img src={photoURL} alt={`${petName || "Pet"} photo preview`} className="h-36 w-full rounded-[14px] object-cover sm:h-44" />
          <button type="button" onClick={() => onPhotoChange("")} className="mt-3 rounded-xl bg-[#FBECEF] px-3 py-2 text-sm font-semibold text-[#B23949]">Remove Photo</button>
        </div>
      ) : null}
    </section>
  );
}
