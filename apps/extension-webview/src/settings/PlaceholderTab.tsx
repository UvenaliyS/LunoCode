import { useT } from "./i18n";

/** Shared body for the not-yet-built tabs (Auto-Approve, Display, Context,
 *  Experimental): pane header with the tab's rail label + a coming-soon note. */
export function PlaceholderTab({ title }: { title: string }) {
  const t = useT();
  return (
    <div className="settings-pane-section animate-fade">
      <div className="pane-header">
        <h2>{title}</h2>
        <p>{t.placeholder.desc}</p>
      </div>
    </div>
  );
}
