# Trekipelago — Specyfikacja integracji Archipelago Multiworld

Niniejszy dokument jest pełną specyfikacją projektową i regułami losowości dla gry **Trekipelago**, przygotowaną dla programistów tworzących zewnętrzny moduł Archipelago (`apworld`, generator losowy lub serwer) w dowolnym języku i środowisku.

---

## 1. Architektura systemu i zasada działania

Trekipelago łączy fizyczny ruch gracza w świecie rzeczywistym (aktywność GPS) ze światem losowym Archipelago Multiworld:
- **Lokalizacje / Checki (Wysyłane z aplikacji na serwer AP)**:
  - **Kamienie milowe dystansu (Distance Checks)**: Gracz zalicza checki za pokonany dystans pieszy w metrach (np. co 500 m).
  - **Kamienie milowe orbów (Orb Checks)**: Gracz zalicza checki za zebranie określonej liczby świetlistych kul w terenie (np. co 5 zebranych orbów).
- **Przedmioty (Odbierane przez aplikację z serwera AP)**:
  - **Progresja (Progression)**: Przedmioty logiczne odblokowujące kluczowe funkcje (śledzenie w tle, pasywne zbieranie, zwiększenie dopuszczalnej prędkości GPS).
  - **Przydatne / Buffy (Useful)**: Czasowe wzmocnienia (podwójny dystans, podwójny drop kul, +50% prędkości).
  - **Pułapki (Traps)**: Negatywne efekty przeszkadzające (zaciemnienie ekranu/mapy, cofnięcie naliczonego dystansu).

---

## 2. Identyfikatory i katalog przedmiotów (Item Catalog)

Baza identyfikatorów numerycznych dla gry Trekipelago wynosi **`7730000`**.

### 2.1 Tabela wszystkich przedmiotów

| ID Przedmiotu | Nazwa wewnętrzna | Nazwa wyświetlana | Kategoria Archipelago | Liczba w puli (Min / Max) | Działanie w aplikacji |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **`7730001`** | `unlock_background` | Background Tracking Unlocked | **Progression** | 1 (stała) | **Klucz logiczny:** Zezwala na naliczanie dystansu i zbieranie w tle, gdy ekran telefonu jest zablokowany lub aplikacja zminimalizowana. Bez tego przedmiotu gra liczy postęp wyłącznie przy włączonym ekranie. |
| **`7730002`** | `passive_collector` | Progressive Passive Collector | **Progression** | 3 (poziomy 1-3) | Uruchamia i ulepsza pasywne zbieranie kul w tle bez konieczności klikania ich na mapie:<br>• Poziom 1: ~1 orb na minutę marszu<br>• Poziom 2: ~3 orby na minutę marszu<br>• Poziom 3: ~5 orbów na minutę marszu |
| **`7730003`** | `progressive_speed` | Progressive Speed Limit | **Progression** | 5 (poziomy 1-5) | Zwiększa dopuszczalny limit prędkości poruszania się, powyżej którego GPS odrzuca punkty jako oszustwo/samochód:<br>• Poziom 0 (początkowy): 6.0 km/h (spokojny marsz)<br>• Poziom 1: 9.0 km/h (szybki marsz)<br>• Poziom 2: 12.0 km/h (lekki jogging)<br>• Poziom 3: 16.0 km/h (bieg)<br>• Poziom 4: 20.0 km/h (szybki bieg / rolki)<br>• Poziom 5: 25.0 km/h (rower miejski) |
| **`7730004`** | `speed_up` | Speed Boost (+50%) | **Useful** | Zmienna (Filler) | Tymczasowy buff (trwa od 5 do 15 minut). Mnoży aktualny dopuszczalny limit prędkości przez współczynnik 1.5x. |
| **`7730005`** | `boost_distance_2x` | Double Distance (2x) | **Useful** | Zmienna (Filler) | Tymczasowy buff (trwa od 5 do 15 minut). Każdy pokonany metr liczy się podwójnie do zaliczania kolejnych checków dystansowych. |
| **`7730006`** | `boost_drop_2x` | Double Orb Drop (2x) | **Useful** | Zmienna (Filler) | Tymczasowy buff (trwa od 5 do 15 minut). Podwaja bieżącą szansę na pojawienie się świetlistych kul w okolicy. |
| **`7730007`** | `trap_blind` | Map Blind Trap | **Trap** | Zmienna (wg `trap_rate`) | Negatywny efekt trwający 60 sekund. Nakłada ciemną mgłę na widok mapy, utrudniając orientację w terenie i lokalizowanie kul. |
| **`7730008`** | `trap_distance` | Lost Distance Trap | **Trap** | Zmienna (wg `trap_rate`) | Natychmiast cofa bieżący dystans gracza o 500 metrów (nie schodzi poniżej 0). |

---

## 3. Lokalizacje i generowanie checków (Location Checks)

Lokalizacje są generowane automatycznie na podstawie konfiguracji YAML wybranego gracza.

### 3.1 Checki dystansu (Distance Milestones)
- **Baza identyfikatorów**: `7740000`
- **Wzór na ID**: `ID = 7740000 + NumerChecku` (np. Check #1 = `7740001`, Check #2 = `7740002`, itd.)
- **Liczba checków dystansowych**:
  $$\text{LiczbaCheckówDystansu} = \left\lfloor \frac{\text{max\_distance\_km} \times 1000}{\text{reward\_interval\_m}} \right\rfloor$$
  *Przykład:* Przy celu 10 km i interwale nagrody co 500 m powstaje dokładnie 20 checków dystansowych (`7740001` do `7740020`).

### 3.2 Checki orbów (Orb Milestones)
- **Baza identyfikatorów**: `7750000`
- **Wzór na ID**: `ID = 7750000 + NumerChecku` (np. Check #1 = `7750001`, Check #2 = `7750002`, itd.)
- **Liczba checków orbów**:
  $$\text{LiczbaCheckówOrbów} = \left\lfloor \frac{\text{max\_orbs}}{\text{orbs\_per\_reward}} \right\rfloor$$
  *Przykład:* Przy celu 50 orbów i nagrodzie co 5 orbów powstaje dokładnie 10 checków orbów (`7750001` do `7750010`).

### 3.3 Łączna liczba lokalizacji w świecie gracza
$$\text{SumaLokalizacji} = \text{LiczbaCheckówDystansu} + \text{LiczbaCheckówOrbów}$$

---

## 4. Logika losowości i konstrukcja puli przedmiotów

Podczas generowania wieloświata (multiworld generation) pula przedmiotów dla gracza Trekipelago musi dokładnie zbilansować liczbę utworzonych checków:

$$\text{RozmiarPuli} = \text{SumaLokalizacji}$$

### 4.1 Gwarantowane przedmioty progresji (Progression Pool)
W puli każdego gracza Trekipelago **zawsze** musi znaleźć się dokładnie **9 gwarantowanych przedmiotów progresji**:
1. **1x** `unlock_background` (Background Tracking Unlocked)
2. **3x** `passive_collector` (Progressive Passive Collector)
3. **5x** `progressive_speed` (Progressive Speed Limit)

### 4.2 Obliczanie wolnych miejsc (Filler Slots)
Pozostałe miejsca w puli przedmiotów stanowią tzw. wypełnienie (filler / junk):
$$\text{WolneSloty} = \text{SumaLokalizacji} - 9$$

> *Uwaga logiczna:* Jeśli suma lokalizacji wynosi mniej niż 9 (np. gracz ustawił bardzo krótki dystans), generator powinien zredukować liczbę poziomów prędkości `progressive_speed` tak, aby dopasować pulę do liczby checków.

### 4.3 Algorytm wypełniania wolnych miejsc (Traps vs Useful Buffs)
Każdy wolny slot jest wypełniany deterministycznie w oparciu o parametr gracza `trap_rate` (od 0% do 100%, domyślnie 15%):

1. **Rzut na rodzaj przedmiotu:**
   - Wylosuj liczbę całkowitą z przedziału $[1, 100]$.
   - Jeżeli wylosowana wartość $\le \text{trap\_rate}$, slot staje się **pułapką (Trap)**.
   - W przeciwnym razie slot staje się **użytecznym buffem (Useful)**.

2. **Wybór konkretnego przedmiotu:**
   - **W przypadku pułapki**, wylosuj z równymi szansami (50% / 50%):
     - `Map Blind Trap` (`7730007`)
     - `Lost Distance Trap` (`7730008`)
   - **W przypadku buffa**, wylosuj z równymi szansami (33.3% / 33.3% / 33.3%):
     - `Speed Boost (+50%)` (`7730004`)
     - `Double Distance (2x)` (`7730005`)
     - `Double Orb Drop (2x)` (`7730006`)

---

## 5. Logika losowości w czasie rzeczywistym (In-Game Engine)

W trakcie samej rozgrywki w aplikacji mobilnej zastosowano następujące matematyczne reguły losowości:

1. **Szansa pojawienia się orba (Spawn Chance):**
   - Wartość bazowa: 20% (`baseChance = 0.20`).
   - Po udanym rzucie szansa maleje geometrycznie:
     $$\text{szansa}_{\text{nowa}} = \text{szansa}_{\text{poprzednia}} \times (1 - \text{spawnReduction})$$
     gdzie $\text{spawnReduction} = 0.25$ (spadek o 25% wartości względnej).
   - Szansa regeneruje się liniowo wraz z marszem gracza:
     $$\Delta\text{szansa} = \text{baseChance} \times \frac{\text{przebyty\_dystans}}{\text{recoveryDistanceMeters}}$$
     gdzie $\text{recoveryDistanceMeters} = 100\,\text{m}$.
   - Szansa nigdy nie przekracza wartości `baseChance`.

2. **Pojawianie się wielu orbów naraz (Multi-Orb Rolls):**
   - Co 10 sekund gra wykonuje rzut.
   - Jeśli rzut zakończy się sukcesem i orb zostanie utworzony, gra natychmiast wykonuje kolejny rzut z nowo obniżoną szansą.
   - Pętla rzutów powtarza się natychmiast, aż do pierwszego nieudanego losowania lub osiągnięcia maksymalnego limitu orbów w okolicy (maksymalnie 50 aktywnych kul).
   - Odliczanie kolejnych 10 sekund startuje dopiero wtedy, gdy seria rzutów zostanie przerwana niepowodzeniem.

3. **Rozmieszczenie przestrzenne kul (Area Spawn Distribution):**
   - Współrzędne orba są losowane na sferycznym wycinku czaszy kuli (ang. *uniform spherical cap*) w promieniu 100 metrów wokół gracza.
   - Dystans kątowy:
     $$d_{\text{ang}} = 2 \arcsin\left(\sqrt{r_1} \times \sin\left(\frac{R_{\text{spawn}}}{2 R_{\text{ziemia}}}\right)\right)$$
   - Kąt azymutu (bearing):
     $$\theta = 2 \pi \times r_2$$
     gdzie $r_1, r_2 \in [0, 1)$ to niezależne liczby losowe. Zapewnia to idealnie jednorodny rozkład prawdopodobieństwa powierzchniowego (orby nie skupiają się sztucznie w centrum).

---

## 6. Opcje konfiguracyjne gracza (YAML Player Options)

W pliku konfiguracyjnym gracza Archipelago (`.yaml`) definiowane są następujące opcje:

| Opcja | Typ | Dopuszczalny zakres | Domyślnie | Opis |
| :--- | :--- | :---: | :---: | :--- |
| `goal` | Wybór (Enum) | `distance`, `orbs`, `both` | `distance` | **Warunek zwycięstwa:**<br>• `distance`: zaliczenie ostatniego checku dystansowego<br>• `orbs`: zaliczenie ostatniego checku orbów<br>• `both`: osiągnięcie obu powyższych celów |
| `max_distance_km` | Liczba całkowita | 1 do 100 | 10 | Docelowy łączny dystans do pokonania w kilometrach. |
| `reward_interval_m` | Liczba całkowita | 200 do 5000 | 500 | Dystans w metrach pomiędzy kolejnymi checkami nagród. |
| `max_orbs` | Liczba całkowita | 10 do 500 | 50 | Docelowa liczba kul świetlistych do zebrania. |
| `orbs_per_reward` | Liczba całkowita | 1 do 25 | 5 | Liczba zebranych kul potrzebna do uzyskania jednego checku. |
| `trap_rate` | Procent (0-100) | 0 do 100 | 15 | Procentowy udział pułapek w wolnych slotach puli (filler). |

---

## 7. Format wymiany danych i synchronizacja (Client-Server Protocol)

Klient Trekipelago łączy się z serwerem Archipelago za pomocą protokołu WebSocket (JSON).

### 7.1 Pakiety serwera i klienta
1. **Inicjalizacja pokoju (`RoomInfo`)**:
   - Serwer wysyła nazwę seeda (`seed_name`).
2. **Uwierzytelnienie (`Connect`)**:
   - Klient wysyła nazwę gry `"Trekipelago"`, nazwę slota (gracza), hasło oraz tagi (`["AP", "DeathLink"]`).
3. **Potwierdzenie połączenia (`Connected`)**:
   - Serwer zwraca `slot_data` zawierające konfigurację wygenerowanego świata:
     - `reward_distance_interval` (liczba)
     - `max_distance_meters` (liczba)
     - `orbs_per_reward` (liczba)
     - `max_orbs_goal` (liczba)
     - `goal_type` (`"distance"`, `"orbs"`, `"both"`)
   - Serwer zwraca także listę już sprawdzonych lokalizacji (`checked_locations`).
4. **Wysyłanie zaliczonych checków (`LocationChecks`)**:
   - Po pokonaniu kolejnego interwału metrów lub zebraniu kolejnych orbów klient wysyła pakiet:
     `{"cmd": "LocationChecks", "locations": [7740001]}`
5. **Odbieranie przedmiotów (`ReceivedItems`)**:
   - Serwer wysyła listę przedmiotów przyznanych graczowi wraz z indeksem. Klient aplikuje odpowiednie efekty (odblokowanie tła, zwiększenie poziomu prędkości, buffy, pułapki).
6. **Zakończenie gry (`StatusUpdate`)**:
   - Po osiągnięciu warunku `goal`, klient wysyła status `40` (`CLIENT_GOAL`), oznaczając wygraną w multiworldzie.

### 7.2 Odporność na brak sieci i synchronizacja w bazie SQLite
Aplikacja Trekipelago posiada pełne podwaliny pod pracę offline/online:
- Wszystkie wysłane i odebrane checki (`checked_locations`) oraz otrzymane przedmioty (`received_items`) są natychmiast utrwalane transakcyjnie w tabeli `archipelago_state` lokalnej bazy SQLite.
- Ostatnio używany host serwera, port, slot gracza i hasło są automatycznie zapamiętywane.
- Po restarcie aplikacji lub utracie zasięgu w terenie, po wznowieniu połączenia następuje automatyczne dosłanie brakujących checków bez utraty postępu.
