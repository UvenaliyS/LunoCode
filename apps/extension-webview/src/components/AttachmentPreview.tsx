import { File, X } from "@phosphor-icons/react";
import type { ChatAttachment } from "../contracts";
import { useLightbox } from "./Lightbox";

/** "12 B" / "34 KB" / "1.2 MB" — mirrors the site's formatBytes. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A single attachment preview — large photo or file card, matching the site's
 *  chat playground. Photos open the shared lightbox on click; file cards are
 *  static. When `onRemove` is given a white close button is overlaid (composer
 *  queue); omit it for the read-only view inside a sent message. */
export function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove?: () => void;
}) {
  const openLightbox = useLightbox();
  const isImage = attachment.kind === "image";

  return (
    <div className="luno-attach-preview">
      {isImage && attachment.dataUrl ? (
        <img
          className="luno-attach-photo"
          src={attachment.dataUrl}
          alt={attachment.name}
          title={attachment.name}
          onClick={() =>
            openLightbox({ src: attachment.dataUrl!, alt: attachment.name })
          }
        />
      ) : (
        <div className="luno-attach-file" title={attachment.path ?? attachment.name}>
          {attachment.lines != null && (
            <span className="luno-attach-lines">{attachment.lines} lines</span>
          )}
          {attachment.bytes != null && (
            <span className="luno-attach-kb">{formatBytes(attachment.bytes)}</span>
          )}
          <div className="luno-attach-file-icon-wrap">
            <File size={44} className="luno-attach-file-icon" />
          </div>
          <div className="luno-attach-file-meta">
            <span className="luno-attach-file-name">{attachment.name}</span>
          </div>
        </div>
      )}

      {onRemove && (
        <button
          className="luno-attach-remove"
          title="Remove"
          onClick={onRemove}
        >
          <X size={13} weight="bold" />
        </button>
      )}
    </div>
  );
}
