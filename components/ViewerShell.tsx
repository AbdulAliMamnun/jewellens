"use client";

import { useEffect, useRef, useState, type DragEventHandler, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
} from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

export interface ViewerShellProps {
  /** Scene contents — rendered inside the canvas. */
  scene: ReactNode;
  /** Top-left chip, hidden in meeting mode. */
  badge?: ReactNode;
  /** Extra buttons alongside Reset view / Meeting mode. */
  actions?: ReactNode;
  /** Bottom bar — stays visible in meeting mode. */
  footer?: ReactNode;
  /** Absolutely positioned overlays (empty states, errors, panels). */
  overlay?: ReactNode;
  canReset?: boolean;
  cameraPosition?: [number, number, number];
  cameraTarget?: [number, number, number];
  className?: string;
  onDragEnter?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
}

/**
 * The gradient studio, lighting, orbit controls and meeting mode shared by the
 * archive viewer and the parametric designer.
 */
export default function ViewerShell({
  scene,
  badge,
  actions,
  footer,
  overlay,
  canReset = true,
  cameraPosition = [0, 0.8, 3.4],
  cameraTarget = [0, 0, 0],
  className,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: ViewerShellProps) {
  const [meetingMode, setMeetingMode] = useState(false);
  const controlsRef = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    if (!meetingMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMeetingMode(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [meetingMode]);

  return (
    <div
      className={[
        "relative isolate select-none overflow-hidden",
        "bg-[radial-gradient(120%_100%_at_50%_0%,#f8f8f9_0%,#e9e9ee_45%,#d3d3dc_100%)]",
        meetingMode
          ? "fixed inset-0 z-50 rounded-none"
          : `rounded-2xl border border-black/10 shadow-sm ${className ?? "h-[560px] w-full"}`,
      ].join(" ")}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: cameraPosition, fov: 38, near: 0.1, far: 100 }}
      >
        <StudioLighting />
        {scene}
        <ContactShadows
          position={[0, -1.08, 0]}
          scale={7}
          opacity={0.42}
          blur={2.6}
          far={2.5}
          resolution={512}
          color="#2a2a33"
        />
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={1.3}
          maxDistance={9}
          target={cameraTarget}
        />
      </Canvas>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">{meetingMode ? null : badge}</div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          {actions}
          <ChromeButton
            onClick={() => controlsRef.current?.reset()}
            disabled={!canReset}
          >
            Reset view
          </ChromeButton>
          <ChromeButton onClick={() => setMeetingMode((on) => !on)}>
            {meetingMode ? "Exit (Esc)" : "Meeting mode"}
          </ChromeButton>
        </div>
      </div>

      {footer ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 p-4">
          {footer}
        </div>
      ) : null}

      {overlay}
    </div>
  );
}

export function ChromeButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="pointer-events-auto rounded-full bg-white/70 px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm backdrop-blur transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * Soft 3-point key/fill/rim plus a procedural studio environment built from
 * lightformers — polished metal is almost entirely reflection, and this keeps
 * those reflections local (no HDRI download at demo time).
 */
function StudioLighting() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[4, 6, 5]} intensity={2.4} />
      <directionalLight position={[-5, 2, 3]} intensity={0.9} />
      <directionalLight position={[0, 3, -6]} intensity={1.6} />
      <Environment resolution={256} frames={1}>
        <color attach="background" args={["#2b2b33"]} />
        <Lightformer form="rect" intensity={6} scale={[10, 4, 1]} position={[0, 6, 1]} />
        <Lightformer form="rect" intensity={3} scale={[8, 6, 1]} position={[-6, 1, 2]} />
        <Lightformer form="rect" intensity={2} scale={[8, 6, 1]} position={[6, 1, -2]} />
        <Lightformer form="ring" intensity={4} scale={4} position={[0, 1, -7]} />
      </Environment>
    </>
  );
}
