// OwlASO product demo — PanelUI design language on canvas.
// Title card → 17 screenshot clips (Ken Burns + mono caption chips, crossfaded)
// → outro. All screenshots are 2960×1840 (1480×920 @2x) in public/shots/.
import React from "react";
import {
  AbsoluteFill,
  CanvasImage,
  Easing,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

// ── Fonts: load the bundled variable fonts before first render ─────────────
const fontsLoaded = async () => {
  const inter = new FontFace(
    "Inter",
    `url(${staticFile("fonts/Inter-Variable.woff2")}) format('woff2')`,
    { weight: "100 900", style: "normal" },
  );
  const mono = new FontFace(
    "Geist Mono",
    `url(${staticFile("fonts/GeistMono-Variable.woff2")}) format('woff2')`,
    { weight: "100 900", style: "normal" },
  );
  const [a, b] = await Promise.all([inter.load(), mono.load()]);
  document.fonts.add(a);
  document.fonts.add(b);
};
const fontHandle = delayRender("owlaso-fonts");
fontsLoaded()
  .then(() => continueRender(fontHandle))
  .catch(() => continueRender(fontHandle)); // fall back to system fonts rather than timing out

// ── Shot list ───────────────────────────────────────────────────────────────
type Shot = { file: string; caption: string; dur: number };

const SHOTS: Shot[] = [
  { file: "01-onboarding.png", caption: "First-run onboarding", dur: 96 },
  { file: "02-empty.png", caption: "Keywords view with tracked apps", dur: 84 },
  { file: "03-keywords.png", caption: "Analyze any keyword — both stores", dur: 104 },
  { file: "04-tooltip.png", caption: "Scoped rich help everywhere", dur: 84 },
  { file: "05-keyword-detail.png", caption: "Trends, rankings, competitor keywords", dur: 116 },
  { file: "06-app-detail.png", caption: "Both stores side by side", dur: 104 },
  { file: "07-add-app.png", caption: "Search and track apps in one step", dur: 92 },
  { file: "08-reviews.png", caption: "Compare reviews across apps", dur: 112 },
  { file: "09-review-detail.png", caption: "Every review in full context", dur: 92 },
  { file: "10-full-data.png", caption: "Full data explorer — 420 reviews, 5 sources", dur: 124 },
  { file: "11-settings.png", caption: "Themes, language and shortcuts", dur: 96 },
  { file: "12-settings-tr.png", caption: "Fully bilingual — English and Türkçe", dur: 92 },
  { file: "20-dark-keywords.png", caption: "Dark mode — keyword analysis", dur: 88 },
  { file: "21-dark-detail.png", caption: "Dark — keyword detail", dur: 96 },
  { file: "22-dark-reviews.png", caption: "Dark — review compare", dur: 92 },
  { file: "23-dark-full-data.png", caption: "Dark — full data explorer", dur: 96 },
  { file: "24-dark-settings.png", caption: "Dark — settings and appearance", dur: 88 },
];

const TITLE_DUR = 96;
export const DEMO_FPS = 30;
const OUTRO_DUR = 104;
const CROSS = 12; // crossfade frames between consecutive clips

const clipStarts = (): number[] => {
  const starts: number[] = [];
  let t = TITLE_DUR - CROSS;
  for (const s of SHOTS) {
    starts.push(t);
    t += s.dur - CROSS;
  }
  return starts;
};
const STARTS = clipStarts();
export const TOTAL_FRAMES =
  STARTS[STARTS.length - 1] + SHOTS[SHOTS.length - 1].dur + OUTRO_DUR;

// ── Shared bits ─────────────────────────────────────────────────────────────
const shotSrc = (name: string) => staticFile(`shots/${name}`);

const OwlMark: React.FC<{ size: number; radius: number }> = ({ size, radius }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: radius,
      background: "#f5f5f5",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <svg
      width={size * 0.58}
      height={size * 0.58}
      viewBox="0 0 64 64"
      fill="none"
      style={{ display: "block" }}
    >
      <circle cx="32" cy="30" r="19" stroke="#141414" strokeWidth="3.6" />
      <circle cx="25.5" cy="28.5" r="5" fill="#141414" />
      <circle cx="38.5" cy="28.5" r="5" fill="#141414" />
      <circle cx="27" cy="27" r="1.7" fill="#f5f5f5" />
      <circle cx="40" cy="27" r="1.7" fill="#f5f5f5" />
      <path d="M28.6 36.5 H35.4 L32 42.5 Z" fill="#141414" />
      <path
        d="M16.5 20.5 L14.5 10.5 L23.5 15.5"
        stroke="#141414"
        strokeWidth="3.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M47.5 20.5 L49.5 10.5 L40.5 15.5"
        stroke="#141414"
        strokeWidth="3.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  </div>
);

// ── Title card ──────────────────────────────────────────────────────────────
export const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const markScale = interpolate(frame, [0, 26], [0.6, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    output: "perceptual-scale",
  });
  const markOpacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const titleY = interpolate(frame, [10, 34], ["22px", "0px"], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const titleOpacity = interpolate(frame, [10, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subOpacity = interpolate(frame, [20, 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subY = interpolate(frame, [20, 44], ["16px", "0px"], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const lineW = interpolate(frame, [28, 56], [0, 232], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const fadeOut = interpolate(frame, [TITLE_DUR - CROSS, TITLE_DUR], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity: fadeOut, background: "#141414", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundImage:
            "radial-gradient(1200px 780px at 50% 26%, #202020 0%, #141414 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 30,
        }}
      >
        <div style={{ scale: `${markScale}`, opacity: markOpacity }}>
          <OwlMark size={132} radius={30} />
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: "Inter",
              fontWeight: 700,
              fontSize: 104,
              letterSpacing: "-0.035em",
              color: "#fafafa",
              opacity: titleOpacity,
              transform: `translate(${titleY})`,
              lineHeight: 1.05,
            }}
          >
            OwlASO
          </div>
          <div
            style={{
              marginTop: 22,
              fontFamily: "Geist Mono",
              fontSize: 19,
              fontWeight: 500,
              letterSpacing: "0.16em",
              color: "#a3a3a3",
              opacity: subOpacity,
              transform: `translate(${subY})`,
            }}
          >
            App Store · Google Play keyword research
          </div>
          <div
            style={{
              margin: "26px auto 0",
              width: lineW,
              height: 2,
              background: "rgba(255,255,255,0.16)",
              borderRadius: 2,
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Screenshot clip ─────────────────────────────────────────────────────────
const ShotClip: React.FC<{ shot: Shot; index: number }> = ({ shot, index }) => {
  const frame = useCurrentFrame();
  const { dur } = shot;
  const dir = index % 2 === 0 ? 1 : -1;

  const opacity = interpolate(
    frame,
    [0, CROSS, dur - CROSS, dur],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Foreground card: subtle reveal 0.985 → 1.0 (never crops content)
  const cardScale = interpolate(frame, [0, dur], [0.985, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    output: "perceptual-scale",
  });
  const cardDrift = interpolate(frame, [0, dur], dir > 0 ? [4, -4] : [-4, 4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  // Blurred backdrop: drifts the opposite way
  const bgScale = interpolate(frame, [0, dur], dir > 0 ? [1.02, 1.075] : [1.075, 1.02], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    output: "perceptual-scale",
  });
  const bgDrift = interpolate(frame, [0, dur], dir > 0 ? [0, -18] : [0, 18], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  // Caption chip entrance
  const capOpacity = interpolate(frame, [CROSS + 4, CROSS + 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const capY = interpolate(frame, [CROSS + 4, CROSS + 24], ["16px", "0px"], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  const bgW = 2040;
  const bgH = Math.round((2040 * 1840) / 2960);

  return (
    <AbsoluteFill style={{ opacity, background: "#141414", overflow: "hidden" }}>
      <CanvasImage
        src={shotSrc(shot.file)}
        style={{
          position: "absolute",
          width: bgW,
          height: bgH,
          left: "50%",
          top: "50%",
          translate: `calc(-50% + ${bgDrift}px) -50%`,
          scale: `${bgScale}`,
          filter: "blur(46px) brightness(0.72) saturate(1.05)",
          opacity: 0.62,
        }}
      />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <CanvasImage
          src={shotSrc(shot.file)}
          style={{
            width: 1737,
            height: 1080,
            borderRadius: 14,
            boxShadow: "0 30px 90px rgba(0,0,0,0.5), 0 6px 18px rgba(0,0,0,0.35)",
            scale: `${cardScale}`,
            translate: `0px ${cardDrift}px`,
          }}
        />
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 56,
          bottom: 44,
          opacity: capOpacity,
          transform: `translate(${capY})`,
          background: "rgba(21,21,21,0.86)",
          border: "1px solid rgba(255,255,255,0.16)",
          borderRadius: 8,
          padding: "11px 18px",
          fontFamily: "Geist Mono",
          fontSize: 21,
          fontWeight: 500,
          letterSpacing: "0.09em",
          color: "#fafafa",
          whiteSpace: "pre",
        }}
      >
        {`${String(index + 1).padStart(2, "0")} · ${shot.caption.toUpperCase()}`}
      </div>
    </AbsoluteFill>
  );
};

// ── Outro card ──────────────────────────────────────────────────────────────
const OUTRO_CHIPS = ["KEYWORD RESEARCH", "REVIEW INTELLIGENCE", "RANK HISTORY"];

export const OutroCard: React.FC = () => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const markScale = interpolate(frame, [0, 24], [0.75, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    output: "perceptual-scale",
  });
  const nameOpacity = interpolate(frame, [12, 32], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const nameY = interpolate(frame, [12, 36], ["18px", "0px"], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const lineW = interpolate(frame, [26, 52], [0, 230], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill style={{ opacity: fadeIn, background: "#141414", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundImage:
            "radial-gradient(1200px 780px at 50% 32%, #202020 0%, #141414 100%)",
        }}
      />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 28 }}>
        <div style={{ scale: `${markScale}` }}>
          <OwlMark size={104} radius={24} />
        </div>
        <div
          style={{
            fontFamily: "Inter",
            fontWeight: 700,
            fontSize: 76,
            letterSpacing: "-0.03em",
            color: "#fafafa",
            opacity: nameOpacity,
            transform: `translate(${nameY})`,
          }}
        >
          OwlASO
        </div>
        <div
          style={{
            width: lineW,
            height: 2,
            background: "rgba(255,255,255,0.16)",
            borderRadius: 2,
          }}
        />
        <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
          {OUTRO_CHIPS.map((chip, i) => {
            const o = interpolate(frame, [34 + i * 10, 52 + i * 10], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            });
            const y = interpolate(frame, [34 + i * 10, 56 + i * 10], ["12px", "0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            });
            return (
              <div
                key={chip}
                style={{
                  opacity: o,
                  transform: `translate(${y})`,
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 999,
                  padding: "10px 20px",
                  fontFamily: "Geist Mono",
                  fontSize: 17,
                  fontWeight: 500,
                  letterSpacing: "0.12em",
                  color: "#d4d4d4",
                }}
              >
                {chip}
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: "Geist Mono",
            fontSize: 16,
            letterSpacing: "0.14em",
            color: "#737373",
            opacity: interpolate(frame, [64, 84], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          SEE WHERE YOU STAND
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Main composition ────────────────────────────────────────────────────────
export const OwlasoDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: "#141414", fontFamily: "Inter, system-ui, sans-serif" }}>
      <Sequence durationInFrames={TITLE_DUR}>
        <TitleCard />
      </Sequence>
      {SHOTS.map((shot, i) => (
        <Sequence key={shot.file} from={STARTS[i]} durationInFrames={shot.dur}>
          <ShotClip shot={shot} index={i} />
        </Sequence>
      ))}
      <Sequence from={TOTAL_FRAMES - OUTRO_DUR} durationInFrames={OUTRO_DUR}>
        <OutroCard />
      </Sequence>
    </AbsoluteFill>
  );
};
