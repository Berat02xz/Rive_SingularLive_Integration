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
- **Audio Asset Support** – Play audio files through Rive audio assets exported as reference type
- **Font Support** – Render custom fonts using MetricFonts and Google Fonts integration


![Gif](https://github.com/Berat02xz/Rive_SingularLive_Integration/blob/main/zMisc/rive2.gif)


## Release Status

### V1 Released
- Artboard selection with real-time property updates
- Dynamic UI generation from Rive inputs/properties
- WebGL2 and Canvas renderer support
- Multiple layout options

### V2 Released
- State Machine selection support
- FPS counter for performance testing
- Image and enum property support

### V3 Released
- Removed startup flicker
- Basic Rive list → Singular table support

### V4 Released
- Locked to Rive runtime version 2.37.5

### V5 Released
- Font support in Singular via MetricFonts
- Google Fonts selection support
- Rive fonts must be exported as font asset reference type
- CEF 75 compatibility support for enterprise software

### V6 Released
- Advanced Rive list → Singular table support
- Sorting, row deletion, instances, and improved table behavior
- Locked to Rive runtime version 2.37.8

### V7 Development
- Audio file support via Rive audio assets
- Rive audio assets must be exported as reference type
- Locked to Rive runtime version 2.38.0

---

### 🧪 Note  
This project is constantly evolving with ongoing bug fixes and improvements in collaboration with the Singular team.  

