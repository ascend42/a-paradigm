# workshop (first-party Gnomon mod)

The Workshop view (spec §11.6): a sidebar strip with two zones.

- **needs you**: one cap per pending card, labelled with the card's kind.
- **working**: one cap per open session. A cap bobs only while its session streams (`turn.partial`) and stands still otherwise. With reduced motion it shows the word `working` instead.

Each cap is a kit `Text` node: its `text` is the accessible form, and its `cap` is the closed shape `{shape, hue, filled, state, label}` (gnomon-contracts `checkCap`). The kernel's mod-block gate refuses any other cap field, and the GUI draws the hat from these five fields alone. Where the strip shows (a footer strip, a left or right column, or hidden) is the GUI Layout's choice; the manifest slot stays `sidebar`.

Every attribute comes from kernel events that the host projects to the mod (`#mod-host` feed, granted by `log.read`). Nothing comes from model text. The hat shape shows the work type, a filled hat means Claude and an outlined hat means local, the hue shows the project, and violet is used only for a KNOT.

Install it with `gnomon mod install packages/gnomon-mods/workshop`, then approve the card in the GUI. Its packageHash is pinned in the kernel's first-party list, so editing any file here needs a new pin.
