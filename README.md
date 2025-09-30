# Rive Live Graphics Controller

This project is a **experimental [Rive](https://rive.app/) controller + viewer** for **live graphics workflows** like sports broadcasts, streaming overlays, and dashboards.  
It’s in **early development**, being tested in a **production TV sports graphics controller**, and will continue to evolve with the fast-moving Rive ecosystem.

---

## 🎯 Goals
The aim of this project is to provide a **generic controller for Rive files**.  
Eventually, it will:
- Load **any `.riv` file** dynamically.  
- Inspect its **State Machine inputs** and **ViewModel instance properties**.  
- Automatically generate **interactive controls**:
  - **String inputs** → text fields  
  - **Triggers** → buttons  
  - **Numbers, booleans, sliders, etc.** → appropriate inputs  

This will allow operators to manipulate Rive graphics without writing custom code for each project.

---

## 🖥️ Architecture
- **Controller Page**  
  - UI for editing Rive ViewModel inputs and firing State Machine triggers.  
  - Updates are stored in `localStorage`.  

- **Viewer Page**  
  - Displays the Rive animation at full screen.  
  - Reacts to changes made in the Controller by reading `localStorage`.  
  - Designed to run inside **OBS Browser Source** or other broadcast software.  

This separation makes it possible to run **real-time, remote-controlled graphics** in professional live production workflows.

---

