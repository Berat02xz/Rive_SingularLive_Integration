# Singular.Live Rive Widget  

**Integrating Rive animations into the Singular Live platform for next-gen real-time graphics.**  

This project brings **Rive’s WebGL2-based rendering and ViewModel architecture** into **Singular Live widgets**.  
The goal is to enable seamless use of `.riv` files as live, data-driven overlays directly inside the Singular Live ecosystem — complete with vector feathering, GPU acceleration, and dynamic control via Rive’s ViewModelInstances.

![Gif](https://github.com/Berat02xz/Rive_SingularLive_Integration/blob/main/zMisc/rive1.gif)

## What This Widget Does

- **Real-time Rive Animation Rendering** – Load `.riv` files directly into Singular.Live compositions with WebGL2 or Canvas rendering
- **Dynamic ViewModel Property Control** – Automatically generates UI controls for all Rive ViewModel properties (strings, numbers, booleans, colors, images, enums, triggers)
- **Artboard Selection** – Switch between different artboards within a Rive file on-the-fly
- **State Machine Support** – Select and control different state machines dynamically
- **Live Data Binding** – Update Rive animations in real-time based on Singular.Live data sources
- **Nested ViewModel Support** – Handles complex Rive files with nested ViewModels and maintains property hierarchy
- **Global ViewModel Support** – Exposes file-wide Global ViewModel properties as top-level Singular control groups
- **Audio Asset Support** – Play audio files through Rive audio assets exported as reference type
- **Font Support** – Render custom fonts using MetricFonts and Google Fonts integration


![Gif](https://github.com/Berat02xz/Rive_SingularLive_Integration/blob/main/zMisc/rive2.gif)


## Release Status

### V1 Released

- **Artboards:** Select the artboard to display and update its properties live.
- **Dynamic controls:** Generate Singular UI controls from Rive inputs and properties.
- **Rendering:** Choose between WebGL2 and Canvas renderers.
- **Layout:** Select how the animation fits within the widget.

### V2 Released

- **State machines:** Select the state machine to run on the active artboard.
- **Performance:** Display an FPS counter for rendering checks.
- **Properties:** Control image and enum properties from Singular.

### V3 Released

- **Startup:** Removed flicker while the animation loads.
- **Lists:** Added initial support for connecting Rive lists to Singular table data.

### V4 Released

- **Runtime:** Pinned the Rive runtime to `2.37.5`.

### V5 Released

- **Fonts:** Added Singular MetricFont controls, including Google Fonts selection.
- **Asset setup:** Export Rive font assets as references to use these font controls.
- **Compatibility:** Added support for enterprise software using CEF 75.

### V6 Released

- **Lists:** Improved Rive list integration with Singular table data, including sorting, row deletion, and instance management.
- **Runtime:** Pinned the Rive runtime to `2.37.8`.

### V7 Released

- **Audio:** Added playback through Rive audio assets. Export audio assets as references to use this feature.
- **Font properties:** Added independent Singular MetricFont controls for Rive data-bound font properties.
- **Live fonts:** Swap referenced and data-bound fonts without reloading the `.riv` file.
- **Missing characters:** Added runtime glyph fallback support.
- **Global controls:** Discover file-wide global View Models and display their controls above artboard-specific groups.
- **Font loading:** Cache font requests and try the Google Fonts API, the Google Fonts GitHub repository, then Inter as a fallback.
- **Runtime:** Pinned the Rive runtime to `2.40.1`.

### V8

- **Runtime:** Pinned WebGL2 and Canvas to Rive runtime `2.44.0`, which includes Rive Semantics support.
- **Images:** Reject failed HTTP responses and image decoding errors. Call `.play()` after assigning an image so a settled state machine can process the change.
- **Reworked View Models Controls:** Generate controls from the selected artboard's bound View Model, with nested properties and separate global View Model groups. Nested group titles show the property and child model, with the parent model in the info tooltip.
- **List rendering:** Preserve authored rows and create added rows from the View Model's default instance, retaining fonts, styles, and internal animation values.
- **JSON binding:** Assign values using the declared Rive property type. Number properties accept decimal strings such as `"25"` and `"12.5"`; invalid numeric values such as `"aaaa"` or `"2a91"` become `0`. Boolean strings are also handled explicitly.
- **Table data:** Accept row arrays, single-row objects, and table arrays wrapped under a Control Node ID.
- **Nested row data:** Support nested View Model objects and enum values in list JSON.
- **Internal properties:** Hide properties containing `__` from the generated controls and default JSON, and protect them from public JSON writes while their Rive bindings remain active.

---

### 🧪 Note  
This project is constantly evolving with ongoing bug fixes and improvements in collaboration with the Singular team.  


### Planned

- Explore GPU Canvas and stateful component support, including the effect of disabling `useOffscreenRenderer` on context sharing and memory usage.
