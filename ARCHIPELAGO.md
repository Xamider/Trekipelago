# Trekipelago - Archipelago Game Integration Specification

## 1. Koncepcja Gry

**Trekipelago** to plenerowa gra mobilna typu GPS geotracking połączona z multi-światowym systemem losowości **Archipelago Multiworld**.
Gracz pokonuje rzeczywisty dystans pieszo lub na rowerze oraz zbiera wirtualne *orby światła* pojawiające się w jego strefie zasięgu, aby odblokowywać czeki (lokacje) i przedmioty w wieloosobowej rozgrywce Archipelago.

---

## 2. Pętla Rozgrywki (Core Loop)

1. **Ruch w terenie (Geotracking):**
   - Aplikacja rejestruje przebyty dystans gracza przy użyciu dokładnych koordynatów GPS (z odrzucaniem skoków i jittera stacjonarnego).
   - Co ustaloną odległość (domyślnie co **500 m**) gracz odblokowuje czek Archipelago (otrzymuje przedmiot z puli lub wysyła czek do innego gracza w multiworldzie).

2. **Pojawianie się orbów (Orb Spawning System):**
   - Wokół aktualnej pozycji gracza, w promieniu strefy (domyślnie **100 m**), co 10 sekund aplikacja próbuje wygenerować świetlisty orb.
   - Wartość bazowa: 20% (`baseChance = 0.20`).
   - Po udanym rzucie szansa maleje geometrycznie:
     $$\text{szansa}_{\text{nowa}} = \text{szansa}_{\text{poprzednia}} \times (1 - \text{spawnReduction})$$
     gdzie $\text{spawnReduction} = 0.125$ (spadek o 12.5% wartości względnej - 50% wolniej niż pierwotne 25%).
   - Szansa regeneruje się liniowo wraz z marszem gracza:
     $$\Delta\text{szansa} = \text{baseChance} \times \frac{\text{przebyty\_dystans}}{\text{recoveryDistanceMeters}}$$
     gdzie $\text{recoveryDistanceMeters} = 400\,\text{m}$ (regeneracja 75% wolniejsza niż pierwotne 100 m).
   - Szansa nigdy nie przekracza wartości `baseChance`.

3. **Pojawianie się wielu orbów naraz (Multi-Orb Rolls):**
   - Co 10 sekund gra wykonuje rzut.
   - Jeśli rzut zakończy się sukcesem i orb zostanie utworzony, gra natychmiast wykonuje kolejny rzut z nowo obniżoną szansą.
   - Pętla rzutów powtarza się natychmiast, aż do pierwszego nieudanego losowania lub osiągnięcia limitu.
   - Gracz może więc przy jednym interwale (10s) znaleźć 1, 2, 3 lub więcej orbów, jeśli ma szczęście.

4. **Zbieranie orbów:**
   - Orby pojawiają się na mapie w zasięgu gracza. Gracz dotyka orba, aby go zebrać.
   - Co ustaloną liczbę zebranych orbów (domyślnie co **5 orbów**) następuje odblokowanie czeku/nagrody z puli orbów.
