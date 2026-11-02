import React from "react";
import { Composition } from "remotion";
import { OwlasoDemo, TOTAL_FRAMES } from "./Demo";
import { LIVE_TOTAL, OwlasoDemoLive } from "./Live";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="OwlasoDemo"
        component={OwlasoDemo}
        durationInFrames={TOTAL_FRAMES}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="OwlasoDemoLive"
        component={OwlasoDemoLive}
        durationInFrames={LIVE_TOTAL}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
