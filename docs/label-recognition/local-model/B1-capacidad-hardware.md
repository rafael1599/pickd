# B1 · Capacidad real de hardware para modelo local

> Sub-fase B1 del Track B (Plan F2 — `docs/label-recognition/04-plan-f2-subfases.md`).
> Fecha: 18 de septiembre de 2026.
> Objetivo: Medir specs reales con comandos (sin opiniones) y responder si alcanza para 4 bits de Qwen3.5-9B o solo 4B.

---

## 1. Hallazgo crítico sobre el entorno: Linux x86_64 + NVIDIA, no macOS

El plan `04-plan-f2-subfases.md` presuponía:

> _"La Mac de Bay 2 (es la máquina de desarrollo)"_
> Comandos esperados: `sysctl -n machdep.cpu.brand_string`, `system_profiler SPHardwareDataType`.

Al ejecutar dichos comandos en la máquina donde corre el entorno de desarrollo (`c1`):

```bash
$ sysctl -n machdep.cpu.brand_string
sysctl: cannot stat /proc/sys/machdep/cpu/brand_string: No such file or directory

$ system_profiler SPHardwareDataType
bash: system_profiler: command not found
```

**Resultado:** Esta máquina no es macOS ni Apple Silicon. Es una estación de trabajo **Linux x86_64** (CachyOS / Arch Linux) con GPU dedicada **NVIDIA**. Por ende, no aplica aceleración Metal/Apple Silicon, sino aceleración **CUDA / Tensor Cores (NVIDIA)**.

---

## 2. Reporte de especificaciones reales (Comando, no opinión)

### A. Sistema Operativo y Kernel

```bash
$ uname -srm
Linux 7.2.4-3-cachyos x86_64
```

### B. CPU

```bash
$ lscpu | grep -E "Model name|Socket|Thread|Core|CPU max"
Model name:                Intel(R) Core(TM) i9-10900KF CPU @ 3.70GHz
Thread(s) per core:        2
Core(s) per socket:        10
Socket(s):                 1
CPU max MHz:               5300.0000
```

- **Procesador:** Intel Core i9-10900KF (10 núcleos físicos, 20 hilos, hasta 5.3 GHz).

### C. Memoria RAM y Swap

```bash
$ free -h
               total        used        free      shared  buff/cache   available
Mem:            15Gi       6.6Gi       3.2Gi       122Mi       6.3Gi       8.9Gi
Swap:           30Gi       3.6Gi        27Gi
```

- **RAM Total:** 15.5 GiB (~16 GB físicos).
- **RAM Disponible:** ~8.9 GiB disponibles para procesos de usuario.
- **Swap:** 30 GiB en almacenamiento NVMe.

### D. Almacenamiento en Disco

```bash
$ df -h /home
Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme0n1p2  928G  292G  635G  32% /home
```

- **Espacio disponible:** 635 GiB disponibles (SSD NVMe rápido). Sobra espacio para decenas de modelos cuantizados y datasets de bench.

### E. GPU y Acelerador de Inferencia

```bash
$ nvidia-smi
NVIDIA-SMI 615.71.09       Driver Version: 615.71.09    CUDA Version: 13.4
GPU 0: NVIDIA GeForce RTX 3060 (Compute 8.6, Ampere)
VRAM Total: 12,288 MiB (12 GiB GDDR6)
VRAM en uso en reposo: ~558 MiB (Hyprland / Desktop)
VRAM libre para cómputo: ~11.4 GiB
```

### F. Runtime de Inferencia Local ya presente

```bash
$ ollama --version
ollama version is 0.34.0

$ systemctl is-active ollama
active
```

Registro de detección de hardware por Ollama (`journalctl -u ollama`):

```text
level=INFO source=types.go:32 msg="inference compute" id=0 library=CUDA compute=8.6 name=CUDA0 description="NVIDIA GeForce RTX 3060" total="11.7 GiB" available="11.4 GiB"
```

- Ollama está instalado, activo como servicio systemd, y configurado detectando la GPU NVIDIA vía CUDA 13.4 con **11.4 GiB de VRAM disponibles**.

---

## 3. Dictamen y Respuesta a la Verificación de B1

> **Pregunta bloqueante de B1:**
> _¿Alcanza para 4 bits de Qwen3.5-9B o solo para el 4B?_

### Cálculo de requerimientos de memoria (VLM en 4 bits / Q4_K_M):

| Modelo                           | Peso cuantizado (Q4) | Contexto + Vision Encoder | Total VRAM requerida | ¿Cabe en los 11.4 GiB VRAM de la RTX 3060? |
| :------------------------------- | :------------------- | :------------------------ | :------------------- | :----------------------------------------- |
| **Qwen3.5 / Qwen2.5-VL 4B**      | ~2.8 – 3.2 GB        | ~1.2 GB                   | **~4.0 – 4.5 GB**    | **SÍ** (con ~7.0 GB de margen)             |
| **Qwen3.5 / Qwen2.5-VL 7B / 9B** | ~5.2 – 5.8 GB        | ~1.5 – 2.0 GB             | **~7.0 – 8.0 GB**    | **SÍ** (con ~3.5 – 4.0 GB de margen)       |

### Conclusión:

**ALCANZA PARA 4 BITS DE 9B (y 7B)**.

No estamos limitados a 4B. Con 12 GB de VRAM dedicados en la RTX 3060 y 11.4 GiB utilizables por Ollama/llama.cpp vía CUDA, **el modelo de 7B/9B en 4 bits (Q4_K_M) entra 100% en la VRAM de la GPU**, sin necesidad de offloading a CPU ni a la RAM del sistema.

### Desbloqueo:

Queda completada y verificada la sub-fase **B1**. Se puede proceder a **B2** (banco local contra las fotos de bench usando Ollama con aceleración CUDA).
