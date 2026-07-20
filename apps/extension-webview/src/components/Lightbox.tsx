import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { X } from "@phosphor-icons/react";

/** An image opened full-screen. */
interface LightboxImage {
  src: string;
  alt: string;
}

const LightboxContext = createContext<(img: LightboxImage) => void>(() => {});

/** Full-screen image viewer, shared across the composer and message list so
 *  there's a single overlay no matter which preview was clicked. Wrap the app
 *  once; any descendant calls useLightbox() to open a photo. */
export function LightboxProvider({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<LightboxImage | null>(null);
  const open = useCallback((img: LightboxImage) => setImage(img), []);
  const close = useCallback(() => setImage(null), []);

  // Escape closes; only bound while an image is open.
  useEffect(() => {
    if (!image) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [image, close]);

  return (
    <LightboxContext.Provider value={open}>
      {children}
      {image && (
        <div className="luno-lightbox" onClick={close}>
          <button className="luno-lightbox-close" title="Close" onClick={close}>
            <X size={18} weight="bold" />
          </button>
          <img
            className="luno-lightbox-img"
            src={image.src}
            alt={image.alt}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </LightboxContext.Provider>
  );
}

/** Open an image full-screen. */
export function useLightbox(): (img: LightboxImage) => void {
  return useContext(LightboxContext);
}
