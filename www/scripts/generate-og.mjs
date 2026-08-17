import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const literataPath = path.resolve(__dirname, "fonts/or3PQ6P12-iJxAIgLa78DkrbXsDgk0oVDaDPYLanFLHpPf2TbBG_F_Y.ttf");
const outfitPath = path.resolve(__dirname, "fonts/QGYyz_MVcBeNP4NjuGObqx1XmO1I4TC1C4E.ttf");
const iconPath = path.resolve(root, "public/gridline-icon.svg");

const fonts = [
  { name: "Literata", data: fs.readFileSync(literataPath), weight: 400, style: "normal" },
  { name: "Outfit", data: fs.readFileSync(outfitPath), weight: 400, style: "normal" },
];

const iconSvg = fs.readFileSync(iconPath, "utf-8");
const iconDataUri = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString("base64")}`;

const element = {
  type: "div",
  props: {
    style: {
      width: 1200,
      height: 630,
      background: "#0a0a0a",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 80,
      fontFamily: "Outfit",
      color: "#fafafa",
      position: "relative",
    },
    children: [
      {
        type: "div",
        props: {
          style: {
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 50% 0%, rgba(59,130,246,0.15), transparent 60%)",
          },
        },
      },
      {
        type: "img",
        props: {
          src: iconDataUri,
          width: 140,
          height: 140,
          style: { marginBottom: 40 },
        },
      },
      {
        type: "h1",
        props: {
          style: {
            fontFamily: "Literata",
            fontSize: 84,
            fontWeight: 400,
            lineHeight: 1.05,
            textAlign: "center",
            margin: 0,
            letterSpacing: "-0.02em",
          },
          children: "Gridline",
        },
      },
      {
        type: "p",
        props: {
          style: {
            fontSize: 32,
            color: "rgba(255,255,255,0.55)",
            marginTop: 24,
            textAlign: "center",
            maxWidth: 800,
          },
          children: "The open-source database GUI for PostgreSQL, MySQL, SQLite, and Redis.",
        },
      },
      {
        type: "div",
        props: {
          style: {
            position: "absolute",
            bottom: 48,
            fontSize: 22,
            color: "rgba(255,255,255,0.35)",
            fontFamily: "Outfit",
          },
          children: "getgridline.app",
        },
      },
    ],
  },
};

const svg = await satori(element, { width: 1200, height: 630, fonts });
const png = await sharp(Buffer.from(svg)).png().toBuffer();
const outPath = path.resolve(root, "public/og.png");
fs.writeFileSync(outPath, png);
console.log(`OG image written to ${outPath}`);
