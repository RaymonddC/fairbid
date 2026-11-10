"use client";

import { useEffect, useId, useRef, useState } from "react";

const MAX_SIDE = 900;

// Shrink a picked image to a JPEG data URL so several fit in localStorage.
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable"));
    };
    img.src = url;
  });
}

export function PhotoPicker({
  photos,
  onChange,
  max = 4,
  label,
  hint,
  addLabel = "Add photo",
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  max?: number;
  label: string;
  hint: string;
  addLabel?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<number | null>(null);

  const add = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (images.length < files.length) setError("Only image files can be added.");
    const room = max - photos.length;
    if (images.length > room) setError(`You can add up to ${max} photos. Remove one to add another.`);
    try {
      const shrunk = await Promise.all(images.slice(0, Math.max(0, room)).map(shrink));
      onChange([...photos, ...shrunk]);
    } catch {
      setError("One photo could not be read. Try a JPG or PNG.");
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="text-xs text-muted">
          {photos.length} of {max}
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
        {photos.map((src, i) => (
          <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-paper">
            <button type="button" onClick={() => setView(i)} className="h-full w-full" aria-label={`View photo ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
            <button
              type="button"
              onClick={() => onChange(photos.filter((_, j) => j !== i))}
              className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-ink/80 text-sm text-canvas after:absolute after:-inset-2 after:content-[''] hover:bg-flag"
              aria-label={`Remove photo ${i + 1}`}
            >
              ×
            </button>
          </div>
        ))}

        {photos.length < max && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              add(e.dataTransfer.files);
            }}
            className={`grid aspect-square place-items-center rounded-lg border-2 border-dashed p-2 text-center text-xs ${
              over ? "border-dye bg-dye-soft text-dye" : "border-line text-muted hover:border-dye hover:text-dye"
            }`}
          >
            <span className="grid justify-items-center gap-1">
              <CameraIcon />
              {addLabel}
            </span>
          </button>
        )}
      </div>

      <input
        ref={input}
        id={id}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      {error ? <p className="text-xs text-flag">{error}</p> : <p className="text-xs text-muted">{hint}</p>}

      {view !== null && photos[view] && <Lightbox photos={photos} start={view} onClose={() => setView(null)} />}
    </div>
  );
}

export function PhotoStrip({ photos, label, size = "md" }: { photos: string[]; label: string; size?: "xs" | "sm" | "md" }) {
  const [view, setView] = useState<number | null>(null);
  if (photos.length === 0) return null;
  // Every thumbnail is at least 44 px so it is easy to tap on a phone.
  const box = size === "xs" ? "h-11 w-11" : size === "sm" ? "h-12 w-12" : "h-20 w-20";
  return (
    <>
      <ul className={`flex ${size === "xs" ? "flex-nowrap gap-1" : "flex-wrap gap-2"}`} aria-label={label}>
        {photos.map((src, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => setView(i)}
              className={`${box} overflow-hidden rounded-lg border border-line bg-paper hover:border-dye`}
              aria-label={`${label}, photo ${i + 1} of ${photos.length}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      {view !== null && <Lightbox photos={photos} start={view} onClose={() => setView(null)} />}
    </>
  );
}

function Lightbox({ photos, start, onClose }: { photos: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    // No close() in cleanup: it fires the close event, which would unmount the lightbox again
    // in dev (effects run twice). Removing the element from the DOM ends the modal anyway.
    if (d && !d.open) d.showModal();
  }, []);

  const go = (step: number) => setI((n) => (n + step + photos.length) % photos.length);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
      className="m-auto max-h-[90vh] max-w-[min(92vw,960px)] rounded-xl bg-surface p-0 backdrop:bg-black/70"
    >
      <div className="grid gap-2 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photos[i]} alt={`Photo ${i + 1} of ${photos.length}`} className="max-h-[75vh] w-full rounded-lg object-contain" />
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted">
            {i + 1} of {photos.length}
          </span>
          <div className="flex gap-2">
            {photos.length > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} className="min-h-11 rounded-md border border-line px-3 hover:border-dye">
                  Previous
                </button>
                <button type="button" onClick={() => go(1)} className="min-h-11 rounded-md border border-line px-3 hover:border-dye">
                  Next
                </button>
              </>
            )}
            <button type="button" onClick={onClose} className="min-h-11 rounded-md bg-ink px-4 text-canvas">
              Close
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function CameraIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
