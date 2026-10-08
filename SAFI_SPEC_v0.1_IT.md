# SAFI v0.1 — Specifica completa

## 1. Cos'è Safi

Safi è un **Human ↔ AI Trust Middleware** indipendente.

Sta tra la persona e qualsiasi sistema AI.

La persona parla normalmente.
Safi interpreta l'intento, prepara una richiesta semanticamente corretta,
inoltra la richiesta attraverso un adapter, riceve una risposta candidata,
la sottopone ai controlli richiesti, corregge quando possibile e produce
una risposta accompagnata da un certificato di fiducia ispezionabile.

Safi non è un'intelligenza artificiale.
Safi non è un chatbot.
Safi non è un agente.
Safi non è React, LangGraph o Langfuse.
Safi non è legato a OpenAI, Gemini, Claude o ad altri provider.

È **il contratto nel mezzo**.

---

## 2. Principio umano

> Nessuna persona dovrebbe essere costretta a imparare a parlare "in promptese".
> È il sistema a doversi adattare all'essere umano.

---

## 3. Flusso

```text
PERSONA
   ↓
HumanRequest
   ↓
Intent Interpreter
   ↓
IntentFrame
   ↓
Intent Guard
   ↓
SafiRequest
   ↓
Provider Adapter
   ↓
QUALSIASI AI / SISTEMA
   ↓
CandidateResponse
   ↓
Verifier Adapter(s)
   ↓
VerificationResult(s)
   ↓
aggregazione deterministica
   ↓
eventuale correzione limitata
   ↓
SafiCertificate
   ↓
Presenter / Empathy Adapter
   ↓
PERSONA + SAFI STAMP
```

---

## 4. I tre stati di fiducia

### VERIFIED
Tutti i controlli obbligatori dichiarati hanno avuto esito positivo.

### UNCERTAIN
Safi non possiede elementi sufficienti per dichiarare superati tutti i controlli.

### FAILED
Almeno un controllo obbligatorio è fallito.

**VERIFIED non significa verità assoluta.**

Significa esclusivamente:

> La risposta ha superato i controlli dichiarati nella `verificationScope`.

Se non viene eseguito alcun controllo, Safi deve restituire `UNCERTAIN`.

---

## 5. Il Safi Stamp

Il protocollo espone:

```text
VERIFIED
UNCERTAIN
FAILED
```

La UI può proiettarli come:

```text
● verde
● arancione
● rosso
```

Il colore non fa parte del protocollo.

Il bollino è una proiezione del `SafiCertificate`.

---

## 6. Progressive disclosure

Utente normale:

```text
●
```

Un tap:

```text
Verificato
```

Secondo livello:

```text
Controlli:
- supporto fonti
- freschezza
Tentativi: 2
```

Livello sviluppatore:

```text
certificate JSON
evidenze
verifier
hash risposta
cronologia tentativi
timestamp
```

La complessità rimane nascosta finché l'utente non la richiede.

---

## 7. Human → AI

L'input umano non è un prompt.

```json
{
  "message": "Spiegamelo come se non sapessi nulla di computer."
}
```

Un interpreter produce un `IntentFrame`.

Safi costruisce quindi un `SafiRequest` semanticamente neutro.

Solo il provider adapter trasforma quel significato nel formato specifico del sistema
destinazione.

Per questo un provider può essere sostituito senza cambiare il protocollo.

---

## 8. AI → Human

Una risposta proveniente dal provider è sempre:

```text
CandidateResponse
```

Mai automaticamente una risposta verificata.

La regola è:

> Generated ≠ Verified.

---

## 9. Verifica

Il Core non pretende di conoscere il mondo.

Definisce l'interfaccia `Verifier`.

Un verifier può controllare:
- matematica;
- fonti;
- coerenza;
- freschezza;
- codice;
- schema;
- dominio;
- citazioni;
- policy.

L'aggregazione finale è deterministica:

```text
nessun controllo richiesto -> UNCERTAIN
controllo richiesto mancante -> UNCERTAIN
un controllo richiesto FAIL -> FAILED
un controllo richiesto INCONCLUSIVE -> UNCERTAIN
tutti i controlli richiesti PASS -> VERIFIED
```

Nessun punteggio universale di "verità 93%".

---

## 10. Correzione

Se una risposta fallisce e il problema è dichiarato correggibile:

```text
FAILED
  ↓
CorrectionStrategy
  ↓
nuova richiesta
  ↓
nuovo CandidateResponse
  ↓
nuova verifica
```

Il numero di tentativi è limitato.

La correzione non può rimuovere controlli obbligatori.

---

## 11. Empathy Engine

L'Empathy Engine è un adapter di presentazione.

Può:
- semplificare;
- usare metafore;
- tradurre gergo;
- adattare il tono;
- localizzare;
- migliorare accessibilità.

Non può:
- cambiare il livello di fiducia;
- nascondere incertezza materiale;
- introdurre nuove affermazioni non supportate;
- cambiare il significato sostanziale.

---

## 12. Certificato

Il `SafiCertificate` lega la risposta a:
- stato di fiducia;
- controlli eseguiti;
- verification scope;
- tentativo;
- provider;
- policy;
- timestamp;
- opzionale SHA-256;
- opzionale cronologia dei tentativi.

Il certificato è la sorgente di verità del bollino.

---

## 13. Output di controllo

Non tutte le richieste producono una risposta.

Safi può restituire:

```text
RESULT
CLARIFICATION
REJECTED
ERROR
```

Questi stati non devono essere confusi con:

```text
VERIFIED
UNCERTAIN
FAILED
```

I primi descrivono il flusso.
I secondi descrivono la fiducia in una risposta.

---

## 14. Confini del Core

Dentro Safi Core:
- tipi del protocollo;
- macchina a stati;
- aggregazione verifiche;
- orchestrazione correzione limitata;
- certificazione.

Fuori dal Core:
- LLM;
- motori di ricerca;
- browser;
- database;
- agenti;
- LangGraph;
- Langfuse;
- React;
- UI;
- provider specifici;
- prompt specifici.

---

## 15. Invarianti

1. Sovranità dell'intento umano.
2. Indipendenza dal provider.
3. Generated ≠ Verified.
4. Nessun verde senza controlli.
5. Incertezza sempre visibile.
6. Nessuna pretesa di verità assoluta.
7. Ogni stamp deve essere spiegabile.
8. La presentazione non può aumentare la fiducia.
9. La presentazione deve preservare il significato.
10. Correzione sempre limitata.
11. Transizioni Core deterministiche.
12. Adapter sostituibili.
13. Evidenze mai inventate.
14. Telemetria opzionale.
15. Verification scope sempre esplicita.

---

## 16. Formula finale

La promessa tecnica di Safi non è:

> "Questa AI dice sempre la verità."

La promessa tecnica di Safi è:

> **"Il livello di fiducia mostrato alla persona corrisponde ai controlli realmente eseguiti sulla risposta."**

Questo è il nucleo di Safi v0.1.
---

## 17. Regola di certificazione del testo finale

L'Empathy Engine non può modificare il testo dopo la certificazione.

Il flusso definitivo è:

```text
risposta grezza provider
        ↓
Empathy / Humanizer
        ↓
testo che vedrà la persona
        ↓
verifica finale
        ↓
Safi Certificate
        ↓
utente
```

Il certificato e il suo hash si riferiscono quindi esattamente al testo mostrato.

Un verifier può confrontare contemporaneamente la risposta grezza e quella
umanizzata per controllare anche la preservazione del significato.

---

## 18. Conflitto tra verificatori

Se due verifier che dichiarano lo stesso controllo non sono d'accordo, Safi
non sceglie semplicemente l'ultimo risultato.

Per uno stesso controllo richiesto:

```text
PASS + FAIL         -> UNCERTAIN
PASS + INCONCLUSIVE -> UNCERTAIN
FAIL + INCONCLUSIVE -> FAILED
tutti PASS          -> PASS
```

Il disaccordo rimane visibile invece di essere nascosto.
