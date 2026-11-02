import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { PawPrint, X } from "lucide-react";

const photoSizes = {
  small: "h-10 w-10 rounded-xl",
  medium: "h-14 w-14 rounded-xl",
  large: "h-20 w-20 rounded-xl",
  preview: "h-40 w-full max-w-xs rounded-xl",
};

export function resolveAppointmentPetPhoto(petRecords, appointment) {
  if (!appointment?.petRecordId || !Array.isArray(petRecords)) return null;
  return petRecords.find(pet => pet?.id === appointment.petRecordId) || null;
}

export function PetPhotoThumbnail({ photoURL, name = "Pet", size = "small", onOpen }) {
  const sizeClass = photoSizes[size] || photoSizes.small;
  if (!photoURL) return <span aria-label="No pet photo uploaded" className={`flex shrink-0 items-center justify-center bg-[#EEF6F6] text-[#2D6B73] ${sizeClass}`}><PawPrint size={size === "small" ? 18 : 22}/></span>;
  return <button type="button" onClick={onOpen} aria-label={`View ${name} photo`} className={`block shrink-0 overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2D6B73] ${sizeClass}`}>
    <img src={photoURL} alt={`${name} pet`} loading="lazy" className={`object-cover ${sizeClass}`} />
  </button>;
}

export function PetPhotoDialog({ photo, name, onClose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return createPortal(<dialog ref={dialogRef} aria-label={`${name} pet photo`} aria-modal="true"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-auto rounded-2xl border border-[#D9E7E7] bg-white p-4 shadow-xl backdrop:bg-black/60 sm:p-6">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-[#173E44]">{name} · Pet Photo</h2><button type="button" autoFocus onClick={onClose} aria-label="Close pet photo" className="rounded-xl p-2 text-[#365057] hover:bg-[#EEF6F6]"><X size={20}/></button></div>
    <img src={photo} alt={`${name} pet`} className="mx-auto mt-4 max-h-[75dvh] max-w-full rounded-xl object-contain" />
  </dialog>, document.body);
}
