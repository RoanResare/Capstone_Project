import { useId, useRef, useState } from "react";
import { Camera, ImagePlus, LoaderCircle, Upload } from "lucide-react";

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ACCEPTED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const MAX_PET_PHOTO_BYTES = 1024 * 1024;

function hasSupportedImageFormat(file) {
  const mimeType = String(file.type || "").toLowerCase();
  if (ACCEPTED_IMAGE_TYPES.has(mimeType)) return true;
  const extension = String(file.name || "").split(".").pop()?.toLowerCase();
  if (!ACCEPTED_IMAGE_EXTENSIONS.has(extension)) return false;
  return !mimeType || mimeType === "application/octet-stream" ||
    (extension === "jpg" || extension === "jpeg" ? mimeType === "image/jpg" || mimeType === "image/jpeg" : mimeType === `image/${extension}`);
}

export function PetPhotoUpload({ photoURL = "", petName = "Pet", onPhotoChange, toast, setFeedback }) {
  const inputId = useId();
  const inputRef = useRef(null);
  const [isReading, setIsReading] = useState(false);

  async function handleFileChange(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const reportError = (message) => {
      setIsReading(false);
      setFeedback?.({ type: "error", message });
      toast?.error(message);
      input.value = "";
    };
    if (!hasSupportedImageFormat(file)) {
      reportError("Choose a JPG, PNG, or WebP image for the pet photo.");
      return;
    }
    if (file.size > MAX_PET_PHOTO_BYTES) {
      reportError("Pet photo must be 1 MB or smaller.");
      return;
    }
    setIsReading(true);
    try {
      const decoded = await createImageBitmap(file);
      const isValid = decoded.width > 0 && decoded.height > 0;
      decoded.close();
      if (!isValid) throw new Error("Invalid dimensions");
      const reader = new FileReader();
      reader.onerror = () => reportError("The selected image could not be read. Please choose another file.");
      reader.onload = () => {
        onPhotoChange(String(reader.result || ""));
        setIsReading(false);
        setFeedback?.({ type: "", message: "" });
        input.value = "";
      };
      reader.readAsDataURL(file);
    } catch {
      reportError("The selected image is corrupt or cannot be decoded. Please choose another image.");
    }
  }

  function openFilePicker() {
    inputRef.current?.click();
  }

  return (
    <section className="@container grid w-full min-w-0 max-w-full gap-2 text-sm font-medium text-[#425A60]" aria-labelledby={`${inputId}-heading`}>
      <div className="box-border min-w-0 max-w-full rounded-[20px] border border-dashed border-[#9FC9C8] bg-[linear-gradient(145deg,#FAFDFC_0%,#EEF7F6_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_4px_12px_rgba(45,107,115,0.06)] transition duration-200 hover:border-[#76B7B5] hover:shadow-[0_7px_16px_rgba(45,107,115,0.10)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#2D6B73] sm:p-3.5">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-white text-[#2D6B73] shadow-[0_3px_9px_rgba(30,73,77,0.12)]">
            <Camera size={19} strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1 basis-36">
            <h3 id={`${inputId}-heading`} className="text-sm font-semibold leading-5 text-[#24444A]">Add a Photo of Your Pet</h3>
            <p className="mt-0.5 text-xs font-normal leading-4 text-[#71878A]">Help our staff recognize your dog or cat.</p>
          </div>
          <button type="button" onClick={openFilePicker} disabled={isReading}
            className="inline-flex min-h-9 max-w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[#2B555C] shadow-[0_2px_7px_rgba(30,73,77,0.1)] transition hover:bg-[#E5F2F1] hover:shadow-[0_3px_9px_rgba(30,73,77,0.14)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2D6B73] disabled:cursor-wait disabled:opacity-70">
            {isReading ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />}
            {isReading ? "Loading Photo" : "Choose Photo"}
          </button>
          <input ref={inputRef} id={inputId} type="file" aria-label="Pet Photo (Optional)" aria-describedby={`${inputId}-help`}
            accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} className="sr-only" />
        </div>
        <p id={`${inputId}-help`} className="mt-2.5 pl-[52px] text-[11px] font-normal leading-4 text-[#809295]">JPG, PNG or WebP · Maximum 1 MB</p>
        {photoURL ? (
          <div className="mt-3 grid min-w-0 max-w-full grid-cols-[4rem_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 rounded-[15px] border border-white/80 bg-white/75 p-2.5 shadow-[inset_0_1px_2px_rgba(30,73,77,0.04)] @min-[26rem]:grid-cols-[4rem_minmax(0,1fr)_auto] @min-[26rem]:gap-x-3">
            <img src={photoURL} alt={`${petName || "Pet"} photo preview`} className="row-span-2 h-14 w-14 shrink-0 rounded-xl object-cover shadow-sm sm:h-16 sm:w-16 @min-[26rem]:col-start-1 @min-[26rem]:row-start-1" />
            <div className="min-w-0 @min-[26rem]:col-start-2 @min-[26rem]:row-start-1">
              <p className="truncate text-xs font-semibold text-[#365057]">Photo ready to save</p>
              <p className="mt-0.5 break-words text-[11px] font-normal text-[#829396]">Preview · private to your pet record</p>
            </div>
            <div className="col-span-2 flex min-w-0 flex-wrap gap-1 @min-[26rem]:col-span-1 @min-[26rem]:col-start-3 @min-[26rem]:row-start-1 @min-[26rem]:min-w-max @min-[26rem]:justify-end">
              <button type="button" onClick={openFilePicker} disabled={isReading}
                className="min-h-9 whitespace-nowrap rounded-lg px-2 text-xs font-semibold text-[#2D6B73] transition hover:bg-[#EDF6F5] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#2D6B73] disabled:opacity-60">Change Photo</button>
              <button type="button" onClick={() => { onPhotoChange(""); setFeedback?.({ type: "", message: "" }); }} disabled={isReading}
                className="min-h-9 whitespace-nowrap rounded-lg px-2 text-xs font-semibold text-[#A3424F] transition hover:bg-[#FFF1F2] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#A3424F] disabled:opacity-60">Remove Photo</button>
            </div>
          </div>
        ) : (
          <span className="sr-only"><ImagePlus aria-hidden="true" /></span>
        )}
      </div>
    </section>
  );
}
