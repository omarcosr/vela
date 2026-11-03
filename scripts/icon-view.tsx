/** The Vela icon (a sail on an amber tile), captured by scripts/make-icon.ts. */
import { createTestRenderer, Window, View, Svg } from "@tarve/core";
import { SAIL } from "../src/ui/theme";
const S = 256;
const r = await createTestRenderer(() => (
  <Window title="i" width={S} height={S} frameless backdrop="transparent" style={{ background: "#00000000" }}>
    <View style={{ width: S, height: S, align: "center", justify: "center", background: "#00000000" }}>
      <View style={{ width: S - 16, height: S - 16, radius: 56, align: "center", justify: "center", background: "linear-gradient(145deg, #fbbf24, #d97706 55%, #9a3412)" }}>
        <Svg size={156} viewBox="0 0 24 24" stroke="none" strokeWidth={0} nodes={SAIL} />
      </View>
    </View>
  </Window>
), { headless: true });
await r.waitForIdle();
await r.capture(process.argv[2]!);
r.close(); process.exit(0);
