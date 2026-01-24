# Singular.Live Rive Widget  

**Integrating Rive animations into the Singular Live platform for next-gen real-time graphics.**  

This project brings **Rive’s WebGL2-based rendering and ViewModel architecture** into **Singular Live widgets**.  
The goal is to enable seamless use of `.riv` files as live, data-driven overlays directly inside the Singular Live ecosystem — complete with vector feathering, GPU acceleration, and dynamic control via Rive’s ViewModelInstances.
## What This Widget Does

- **Real-time Rive Animation Rendering** – Load `.riv` files directly into Singular.Live compositions with WebGL2 or Canvas rendering
- **Dynamic ViewModel Property Control** – Automatically generates UI controls for all Rive ViewModel properties (strings, numbers, booleans, colors, images, enums, triggers)
- **Artboard Selection** – Switch between different artboards within a Rive file on-the-fly
- **State Machine Support** – Select and control different state machines dynamically
- **Live Data Binding** – Update Rive animations in real-time based on Singular.Live data sources
- **Nested ViewModel Support** – Handles complex Rive files with nested ViewModels and maintains property hierarchy

## Release Status

### V1 Released
- Artboard selection and real-time property updates
- Dynamic UI generation
- WebGL2/Canvas renderer support
- Multiple layout options

### V2 In Development
- State machine selection
- FPS counter for performance testing
- Image and enum property support
- Rive list → Singular table support *(in progress)*

---

### 🧪 Note  
This project is constantly evolving with ongoing bug fixes and improvements in collaboration with the Singular team.  

