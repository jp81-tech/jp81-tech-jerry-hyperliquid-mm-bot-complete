# 🔄 Rotation Daemon - Decyzja Projektowa

**Data:** 2025-11-15  
**Status:** ⏸️ **ODŁOŻONE NA PÓŹNIEJ**  
**Priorytet:** Niski (projekt na przyszłość)

---

## ✅ **Decyzja: NIE Wdrażamy Teraz**

**Rotation Daemon** to projekt na później / wersja 2.0, a nie coś, co musimy ruszać, żeby bot działał dobrze i bezpiecznie.

---

## 📋 **Co Mamy TERAZ**

### **Aktualny Stan Bota:**

✅ **Rotacja dzieje się w środku `mm_hl.ts`:**
- `this.rotation.getCurrentPairs()` + Twoje zasady
- `NansenBias` (ZEC / UNI / VIRTUAL) jako filtr / bias
- Soft SL + Nansen SL + per-pair caps

❌ **Rotation Daemon NIE jest używany:**
- Nie ma pliku `scripts/rotation_daemon.ts`
- Nie ma hooka `rotation_consumer_hook.ts`
- Bot nie czyta `runtime/active_pairs.json`

### **Obecny Setup (1-2 dni):**
👉 **ZEC, UNI, VIRTUAL** + obserwacja SL / Nansen  
👉 **Bez rotacji** - stały set par

---

## 🎯 **Po Co W Ogóle Był Rotation Daemon?**

**Ma sens dopiero wtedy, gdy chcesz:**

1. **Oddzielić engine rotacji od bota:**
   - Pisać algorytmy rotacji osobno (nawet w innym repo / języku)
   - Móc update'ować rotację bez restartu bota (Tylko daemon → JSON)

2. **Robić cięższe analizy:**
   - Liczyć skomplikowane metryki z wielu źródeł (HL, Nansen, inne API)
   - Numerować i logować rankingi par bez dotykania core'owego kodu bota

3. **Mieć kilka botów korzystających z tego samego "mózgu rotacji":**
   - Np. kiedyś: spot MM, perp MM, jakiś hedging bot – wszystkie biorą pary z tego samego `active_pairs.json`

**Czyli to jest bardziej infra pod "MM desk", niż coś, czego potrzebujesz do jednego bota z trzema parami na start.**

---

## ⚠️ **Co By Było, Gdybyśmy To Teraz Wdrażali?**

**Żeby Rotation Daemon działał, trzeba by:**

1. Napisać `scripts/rotation_daemon.ts` (pełny scoring par)
2. Napisać `rotation_consumer_hook.ts` i wpiąć go w `mm_hl.ts`
3. Zmienić logikę rotacji tak, żeby:
   - Najpierw patrzyła na `active_pairs.json`
   - Miała solidny fallback, gdy plik jest stary/uszkodzony
   - Miała telemetry / logi / alerty, gdy daemon się wywraca

**To znaczy:** nowy proces + nowe punkty awarii, a my dopiero co:
- Sprzątaliśmy po sed-patchach
- Ratowaliśmy TypeScript
- Robiliśmy upgrade serwera
- Dopinaliśmy Nansen SL + soft SL

**Na tym etapie to tylko podbija złożoność i ryzyko.**

---

## ✅ **Co Robimy Praktycznie**

### **1. Zostawiamy Rotation Daemon jako projekt na później**

- Traktuj to jako "ładnie zaprojektowany szkic", który sobie leży w repo
- Dokumentacja jest gotowa (`docs/ROTATION_INTEGRATION.md`)
- Gdy będziesz gotowy - wszystko jest przygotowane

### **2. Upewniamy się, że nic go nie odpala**

**Na serwerze (dla świętego spokoju):**
```bash
systemctl disable mm-rotation-daemon || true
systemctl stop mm-rotation-daemon || true
```

**Status:** ✅ **Daemon wyłączony i zatrzymany**

### **3. W .env mamy:**

```bash
ROTATE_ENABLED=false
# a resztę ROTATOR_* można zostawić, ale ignorujemy
```

### **4. Skupiamy się na:**

- ✅ **ZEC / UNI / VIRTUAL** bez rotacji przez 1–2 dni
- ✅ **Obserwacji SL / Nansen SL**
- ✅ **Dopieszczeniu caps / cooldownów**
- ✅ Ewentualnie prostym wewnętrznym rotation (bez daemona), jak już będziesz zadowolony z zachowania bota

---

## 📊 **TL;DR – Decyzja**

### **Czy potrzebujemy Rotation Daemon TERAZ?**
👉 **Nie.** Mamy lepsze rzeczy do dopracowania (SL, risk per pair, Nansen).

### **Czy warto go kiedyś zrobić?**
👉 **Tak**, ale dopiero gdy:
- Będziesz zadowolony z jednego bota
- Będziesz chciał centralny "mózg" rotacji dla wielu botów / strategii

---

## 🎯 **Następne Kroki**

**Na teraz:**
1. ✅ Daemon wyłączony i zatrzymany
2. ✅ Skupiamy się na SL audit (ZEC/UNI/VIRTUAL)
3. ✅ Obserwacja i dopieszczenie mechanizmów SL

**Na później (gdy będziesz gotowy):**
- Checklista: co musi działać stabilnie zanim w ogóle dotkniemy Rotation Daemon
- Prosta, "wbudowana" rotacja tylko między ZEC / UNI / VIRTUAL (bez osobnego procesu)

---

## 📁 **Dokumentacja**

**Gotowa dokumentacja (na przyszłość):**
- `docs/ROTATION_INTEGRATION.md` - pełny guide integracji
- `docs/ROTATION_BOT_INTEGRATION_PENDING.md` - staged integration
- `ROTATION_DAEMON_COMPLETE_OVERVIEW.md` - kompletny przegląd
- `config/systemd/mm-rotation-daemon.service` - service file

**Status:** Wszystko gotowe, ale **nie używane** - projekt na później.

---

**Decyzja:** ✅ **ODŁOŻONE** - skupiamy się na stabilności i SL audit.

