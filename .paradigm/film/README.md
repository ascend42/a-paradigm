# Film working directory

Working space for the film crew agents (Quill, Lux, Iris). One subdirectory per project.

## Directory shape

```
.paradigm/film/<project-id>/
  <segment-id>/
    beat-sheet.md          ← Quill writes
    script.yaml            ← Quill writes
    shot-list.yaml         ← Lux writes
    hf-prompts.yaml        ← Lux writes
    talent-cards.yaml      ← Lux writes (prompter cards for talking-head segments)
    assets/                ← Lux writes (HF clips, ingested source video, audio)
      narration.wav
      hf-broll-<id>.mp4
      founder-segment-<n>.mp4
    out/                   ← Iris writes
      project.atelier
      render.mp4
```

## Ownership

| File / dir | Author | Reader |
|---|---|---|
| `beat-sheet.md` | Quill | Lux, humans |
| `script.yaml` | Quill | Lux, Iris (for title text) |
| `shot-list.yaml` | Lux | Iris, humans |
| `hf-prompts.yaml` | Lux | humans (run `higgsfield generate`) |
| `talent-cards.yaml` | Lux | the human on camera |
| `assets/` | Lux + humans | Iris (for asset references) |
| `out/*.atelier` | Iris | humans (run `atelier render`) |
| `out/render.mp4` | `atelier render` CLI | external NLE |

## Phase A vs Phase B

Per `docs/keynote/paradigm/v6-release-video-feasibility.md` (in `a-atelier`):

- **Phase A** (v6.4 launch): Iris authors per-segment motion-graphics only — no `VideoVisual` layers, no master concat. Talking-head composite + HF B-roll + final assembly happens in an external NLE. Credit: "Motion graphics: Atelier."
- **Phase B** (post-Phase 2): Iris authors a master composition that references per-segment comps via `RefVisual`, places alpha-keyed talking-head over Atelier backdrops, and `atelier render` produces the final master. Credit: "Edited in Atelier."

## Privacy

Specific film projects (scripts, shot lists, footage) are often private until launch. Add `.paradigm/film/<project-id>/` to `.gitignore` if you don't want it tracked.

The agent definitions themselves (`.paradigm/agents/showrunner.agent`, `cinematographer.agent`, `composer.agent`) are reusable framework infrastructure and stay public.
