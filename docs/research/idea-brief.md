# PEW-IVF-JOURNEY-IDEA — Idea Research Brief & Scrollytelling UI Architecture

- **Task ID:** `PEW-IVF-JOURNEY-IDEA`
- **Stage:** Idea Mock & Narrative Architecture
- **Data Policy (M3):** Synthetic / educational mock data only. Zero patient identifiers, clinic IDs, real names, contacts, or personal chart notes.
- **Design References:** Inlined reference excerpts cited strictly by filename (`01-layout.md`, `02-typography.md`, `03-scrollytelling.md`, `04-density.md`).

---

## 1. Product Intent

Prospective parents navigating In Vitro Fertilization (IVF) and subsequent pregnancy stages often face overwhelming clinical jargon, fragmented checklists, and high emotional anxiety. Traditional medical portals present this information as dense, multi-widget dashboards or ungrouped walls of cards that amplify cognitive load rather than calming the reader.

The **IVF Journey (`Hành Trình Đón Con Yêu`)** idea mock reframes the Home and Timeline experience from a card-grid dashboard into a **calm, editorial stage journey**. Using `src/data/ivfData.js` as the single source of truth, the interface guides readers sequentially through seven biological and emotional chapters—from ovarian stimulation to postpartum recovery—pacing information through progressive disclosure so only **one focal beat per stage** demands attention at any moment.

---

## 2. User Journey Stages (Single Source: `src/data/ivfData.js`)

The narrative arc spans seven sequential chapters. Each chapter pairs an editorial lead and pull quote with a single focal stage panel containing a milestone strip and a progressive three-lens explorer (`Kiến thức y khoa`, `Nên thực hành`, `Cần tránh`):

| Chapter | Stage ID | Title | Clinical Window / Timeframe | Primary Focal Beat |
| :--- | :--- | :--- | :--- | :--- |
| **Chương 01** | `stage-1` | **Kích Trứng & Tạo Phôi** | Ngày 1 – Ngày 14 chu kỳ | Ovarian response rhythm, 34–36h trigger window, ICSI fertilization, Day-5 blastocyst & PGT screening, OHSS & ovarian torsion prevention. |
| **Chương 02** | `stage-2` | **Chuyển Phôi** | Ngày chuyển phôi (ET / FET) | Endometrial implantation window (24–48h), elective single embryo transfer (eSET), bladder preparation, and post-transfer circulation vs. bed-rest myths. |
| **Chương 03** | `stage-3` | **Đợi Kết Quả (14 Ngày)** | 14 ngày chờ đợi (2WW) | Distinguishing progesterone side effects from early pregnancy signs, Day-14 blood Beta-HCG benchmarks (Day-3 vs. Day-5 embryo), and avoiding premature urine test strips. |
| **Chương 04** | `stage-4` | **3 Tháng Đầu** | Tuần 5 – Tuần 12 thai kỳ | Neural tube closure & folic acid, luteal progesterone continuation until weeks 8–10, fetal heartbeat (weeks 6–8), nuchal translucency & NIPT (week 12). |
| **Chương 05** | `stage-5` | **3 Tháng Giữa** | Tuần 13 – Tuần 27 thai kỳ | 22-week morphology ultrasound, 24–28 week 75g OGTT gestational diabetes screening, spaced Calcium/Iron supplementation, and left-lateral sleep posture. |
| **Chương 06** | **3 Tháng Cuối** | `stage-6` | Tuần 28 – Tuần 40 thai kỳ | 32-week growth & amniotic fluid assessment, CTG fetal heart monitoring, kick-counting rule (>=10 movements in 2 hours), and preeclampsia blood pressure alerts (>=140/90 mmHg). |
| **Chương 07** | `stage-7` | **Sinh & Sau Sinh** | Vượt cạn & 6 tuần hậu sản | Immediate skin-to-skin (Kangaroo care) for thermoregulation and colostrum IgA, early post-op mobilization, lactation hydration, and postpartum mental health safety. |

---

## 3. How the Inlined Reference Excerpts Inform the Mock

All design decisions adapt principles from the four read-only excerpts (`01-layout.md` … `04-density.md`) to a self-contained React + CSS custom-property implementation:

### 3.1 Layout & Narrative Flow (citing `01-layout.md`)
- **Story Flow Over Dashboard Chrome (`01-layout.md`):** Rather than displaying a multi-column control panel, the page uses a centered single-column reading shell (`max-width: 64rem`) where narrative chapters advance vertically as the reader scrolls or steps through stages.
- **Section Rhythm (`01-layout.md`):** Every chapter follows a disciplined editorial sequence:
  1. Chapter meta badge (chapter number + timeframe) and clear stage H2 heading.
  2. Short editorial narrative prose (`narrativeLead`) and pull sentence (`pullQuote`) constrained to a comfortable reading measure (`60ch–68ch`).
  3. **One embedded focal stage panel** that widens slightly within the shell to present the stage's milestone progression and focused category cards.
- **Nested Progressive Disclosure (`01-layout.md`):** Just as a broad topic subdivides progressively as the reader focuses in, the IVF journey moves from the 7-stage macro arc (sticky `Timeline`) → a single active chapter (`StageContent`) → one selected category lens at a time (`Kiến thức y khoa`, `Nên thực hành`, or `Cần tránh`) → deep-dive clinical notes on demand (`Modal`).

### 3.2 Editorial Typography & Hierarchy (citing `02-typography.md`)
- **Editorial Story Tone (`02-typography.md`):** The header reads like a magazine feature with a prominent H1 title, an edition/reading-time byline (`~10 phút đọc • Bản mẫu kiến thức tổng hợp`), and a calm introductory dek.
- **Prose vs. Labels (`02-typography.md`):** Narrative leads use readable body typography (`>=16px` on narrow viewports, scaling cleanly via CSS variables), while focal milestone strips and card groups use concise uppercase/structured eyebrow captions above the visual blocks.
- **Pull Sentences Over Heavy Chrome (`02-typography.md`):** Key medical mindset reminders (e.g., quality over quantity of follicles, why bed rest is counterproductive) are surfaced as typographic pull quotes rather than alarmist popups.
- **Plain-Text Credit & Disclaimer Block (`02-typography.md`):** The journey concludes with a structured editorial credit and medical-scope notice listing roles (Concept & Narrative Structure, UI/UX Engineering, Clinical Reference Synthesis) in plain text lists.

### 3.3 Scrollytelling & Explicit Interaction Cues (citing `03-scrollytelling.md`)
- **Scroll-Linked & Stepped Chapter Beats (`03-scrollytelling.md`):** `IntersectionObserver` tracks which chapter is in the reading zone and updates the sticky `Timeline` wayfinding bar automatically. Readers can also switch to **Stepped Focus (`Từng giai đoạn`)** mode or use chapter step controls to move one stage at a time without long scrolling.
- **Interactions Called Out in Copy (`03-scrollytelling.md`):** Each stage panel includes a brief, plain-language interaction prompt instructing the reader to switch lenses (`Kiến thức` / `Nên làm` / `Cần tránh`), inspect milestone steps, or select any card to open its full breakdown in the modal.
- **Scope Discipline (`03-scrollytelling.md`):** Explanatory milestone bars and interactive lens tabs are built with semantic HTML and CSS; AI helpers or photo/ID tools mentioned in reference stories are explicitly excluded as non-goals.

### 3.4 Visual Density & One Focal Beat per Stage (citing `04-density.md`)
- **Airy Prose, Focused Payoff (`04-density.md`):** Previously, each stage rendered three separate multi-card grids simultaneously (`knowledge` + `dos` + `donts` = up to 8 cards stacked per stage, totaling 47+ cards across the page). Following `04-density.md`, prose remains airy and each stage renders **one unified focal panel** containing:
  1. A **Stage Milestone Strip** summarizing the 4 key chronological beats of that stage and a clinical safety note.
  2. A **Linked Lens Switcher** (`Kiến thức y khoa`, `Nên thực hành`, `Cần tránh`) that reveals one category group at a time by default, preventing a wall-of-data layout while keeping all `ivfData.js` items one tap away.
- **No Unrelated Viz Clones (`04-density.md`):** Avoids D3 egg/nest metaphors, hex/choropleth maps, and multi-year search trend charts in favor of a purpose-built IVF stage timeline and milestone progression strip.

---

## 4. Must / Should / Non-Goals

### Must
1. **Research Brief (`docs/research/idea-brief.md`):** Document product intent, the 7 user journey stages, Must/Should/Non-goals, and how `01-layout.md`, `02-typography.md`, `03-scrollytelling.md`, and `04-density.md` shape layout, typography, scrollytelling, and density (citing filenames only).
2. **Stage Journey UI Evolution:** Evolve `Home.jsx`, `Timeline.jsx`, `StageContent.jsx`, `InfoCard.jsx`, and `Modal.jsx` into a cohesive IVF stage journey driven strictly by `src/data/ivfData.js`.
3. **Self-Contained Styling & System Typography:** Style exclusively through `src/index.css` and `src/App.css` using CSS custom properties and system font stacks (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`); add zero packages and zero external font/icon/asset URLs.
4. **Progressive Stage Reveal & Single Focal Beat:** Support both scroll-linked narrative reveal and stepped stage focus, keeping density to one primary focal panel/beat per stage.

### Should
1. **Typography Rhythm:** Maintain body copy `>=16px` (`1rem` minimum on narrow viewports), modular heading scale, comfortable line lengths (`60ch–68ch`), and short structured captions.
2. **Accessible Hit Targets & Focus:** Ensure all interactive controls (`Timeline` stage buttons, mode toggles, lens tabs, `InfoCard` triggers, `Modal` actions) use semantic `<button>` or link elements with hit targets `>=44x44px` where practical (never below `24x24px`), body text contrast `>=4.5:1`, and visible `:focus-visible` outlines (`>=3:1`).
3. **Reduced Motion Support:** Respect `prefers-reduced-motion: reduce` in both CSS transitions/scroll behavior and Framer Motion props (`useReducedMotion`).
4. **Preserve Existing Diet Flow:** Keep `/pregnancy-diet` (`DietPage.jsx`) intact and reachable from the header and relevant stage cards (`hasDietCTA`) without expanding diet scope.

### Non-Goals
- **No Unrelated Visualizations or AI Widgets:** Do not add D3 egg/nest graphics, species or choropleth maps, Google Trends sparklines, or AI chatbot helpers.
- **No Dependency or Build Changes:** Do not edit `package.json`, lockfiles, or Vite configuration; do not install libraries.
- **No Clinical / Auth / Payment Scope:** No authentication, clinic integrations, real patient records, or diagnostic medical claims.
- **No Restricted Tree Edits:** Do not touch `docs/prd/**`, `docs/trd/**`, `docs/decision-log*`, `.git/**`, `.github/**`, `.env*`, or `_workflow/**`.
