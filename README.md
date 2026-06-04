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

![Gif](https://github.com/Berat02xz/Rive_SingularLive_Integration/blob/main/zMisc/rive2.gif)


## Release Status

### V1 Released
- Artboard selection and real-time property updates
- Dynamic UI generation
- WebGL2/Canvas renderer support
- Multiple layout options

### V2 Released
- State Machine selection
- FPS counter for performance testing
- Image and enum property support

### V3 Released
- Startup flicker removal
- Rive list → Singular table support

### V4 Released
- Locked on 2.37.5 rive runtime version

### V5 Released
- Singular MetricFonts -> Rive Font support (Google Fonts Selection)
- CEF 75 Compatibility support for enterprise software

### V6 Released
- Rive list → Singular table more advanced support for sorting/row deletion/instances etc.
- Locked on 2.37.8 rive runtime version

---

### 🧪 Note  
This project is constantly evolving with ongoing bug fixes and improvements in collaboration with the Singular team.  

