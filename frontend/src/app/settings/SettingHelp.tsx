"use client";

export function SettingHelp({ children, hint }: { children: React.ReactNode; hint: string }) {
  return (
    <span className="settings-help">
      <span>{children}</span>
      <span className="settings-hint">{hint}</span>
    </span>
  );
}
