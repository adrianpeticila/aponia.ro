# APONIA.ro: Independent Practice Management & Clinical Respite Architecture for Psychotherapists

APONIA is a biophilic digital ecosystem and clinical infrastructure engineered specifically for independent psychotherapists, clinical psychologists, and their clients. It pairs commission-free practice management with on-device somatic regulation and evidence-based clinical diagnostics.

---

## Core Product Modules

### 1. Respite Space (Spațiul de Tihnă)
An interactive neuro-somatic regulation suite built to restore autonomic nervous system balance, reduce cognitive overload, and facilitate clinical inter-session grounding.
- **Popas**: Coherence breathing calibrated at 6 breaths per minute (0.1 Hz vagal resonance frequency) with fluid visual and haptic pacing.
- **Jupiter**: 5-4-3-2-1 multi-sensory grounding protocol designed for acute anxiety stabilization and rapid present-moment anchor retrieval.
- **Mars**: Yale Center for Emotional Intelligence RULER 2D somatic matrix and burnout radar mapping emotional valence and physiological arousal.
- **Mercury**: Cognitive unload journal and thought-defusion scratchpad processed purely in-memory.
- **Pricing & Access**: Available as a standalone tier at 29 RON/month via Stripe ([Interactive Demo](https://aponia.ro/wellbeing/demo-unelte.html)).

### 2. Rhea Visibility Score
A 30-second automated visibility and positioning audit for psychotherapists. It evaluates search footprint, local directory authority, booking friction, and digital positioning directly within the client browser without collecting personal data ([Audit Tool](https://aponia.ro/rhea/)).

### 3. Anxiety Screening Tool (GAD-7)
An evidence-based, interactive Generalized Anxiety Disorder 7-item clinical screening instrument. Features instant deterministic scoring, severity classification, and contextual clinical guidance ([Anxiety Test](https://aponia.ro/test-anxietate/)).

### 4. Lost Sessions Calculator
An interactive financial diagnostic tool that quantifies lost revenue and unrecovered hours stemming from client cancellations, no-shows, and manual administrative overhead ([Lost Revenue Calculator](https://aponia.ro/calculator-programari-pierdute/)).

### 5. Biofeedback Wellbeing Engine
A 7-module biophilic sensory regulation protocol crafted for parasympathetic activation and clinical recovery ([Wellbeing Engine](https://aponia.ro/wellbeing/)):
- **Popas**: Cardiac coherence and respiratory pacing.
- **Mugur**: Progressive somatic tension release and gentle awakening.
- **Rădăcină**: Tactile proprioceptive grounding and boundary awareness.
- **Freamăt**: Acoustic natural white/pink noise atmospheric immersion.
- **Tihnă**: Deep parasympathetic restorative cooldown.
- **Adăpost**: Safe psychological boundary containerization.
- **Florilegiu**: Curated neuro-aesthetic micro-reflections.

### 6. Practice Management Platform
A comprehensive clinical management suite engineered for modern independent therapy practices:
- Direct, commission-free appointment scheduling with zero third-party platform markups.
- Automated two-way calendar synchronization (Google Calendar, Apple Calendar, Outlook).
- Encrypted, pre-session client intake forms and clinical notes.
- Direct-to-therapist Stripe billing integration at 73 RON/month ([Web App](https://app.aponia.ro)).

---

## Technical Architecture & Privacy

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Layer                           │
│  - Static Multi-Language CDN Frontend (HTML5 / Vanilla JS)  │
│  - Cross-Platform React Native / Expo Web PWA               │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                Edge & Privacy Sandboxing                    │
│  - 100% Local On-Device Somatic & Diagnostic Computation     │
│  - Zero PII Tracking, No Third-Party Analytics Trackers     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Secure Clinical Core                      │
│  - GDPR Art. 9 Compliant Encrypted Firestore Sub-Collections│
│  - End-to-End Encrypted Pre-Session Clinical Intake Data    │
│  - Direct Stripe Connect Payment Processing                 │
└─────────────────────────────────────────────────────────────┘
```

- **Zero PII Tracking**: Somatic regulation data, journal entries, and diagnostic questionnaire responses are computed entirely in the browser memory and never persisted to external logging servers.
- **GDPR Art. 9 Compliance**: Special category health data within practice management sub-collections utilizes strict client-level encryption and role-based Firebase Security Rules.
- **Biophilic Neuroaesthetics**: Visual design language utilizing organic sage, forest moss, earth tones, and warm amber accents to minimize ocular fatigue and eliminate digital cognitive friction.

---

## License & Operations

Operated under the APONIA brand. All rights reserved.
