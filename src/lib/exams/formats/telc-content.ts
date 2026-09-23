/* The four telc levels' sections, blocks, criteria and B2's fixed speaking
   themes, in the exam's own German, carried over from the telc simulator's
   exam source (exam-src/05-levels.js and the level folders). Generated;
   edit the wording here only when the exam's wording changes. */

const TELC_CONTENT = {
 "A1": {
  "name": "telc Deutsch A1",
  "subtitle": "Start Deutsch 1",
  "who": "Erste Deutschkenntnisse: sich vorstellen, einkaufen, nach dem Weg fragen.",
  "timeLine": "75 Min. schriftlich · ca. 15 Min. mündlich",
  "lede": "Hier üben Sie die telc-Prüfung Deutsch A1 am Computer. Der Test hat 4 Teile: Hören, Lesen, Schreiben und Sprechen. Alles ist so aufgebaut wie in der echten Prüfung.",
  "rules": [
   "Die Aufgaben sind bei jedem Start neu gemischt.",
   "Ein Programm liest die Hörtexte vor. Vor jedem Text haben Sie Zeit zum Lesen.",
   "Ein Übersetzer funktioniert hier nicht. Der Test stoppt, wenn Sie einen benutzen.",
   "Ihren Text und Ihr Sprechen bewerten in der Prüfung Personen. Hier sehen Sie ein Beispiel und schätzen sich selbst ein."
  ],
  "passNote": "Bestanden ab 36 von 60 Punkten. Schriftlicher und mündlicher Teil werden zusammengezählt.",
  "rows": [
   [
    "Hören",
    "3 Teile · 15 Aufgaben",
    "ca. 20 Min.",
    "15 P."
   ],
   [
    "Lesen",
    "3 Teile · 15 Aufgaben",
    "ca. 25 Min.",
    "15 P."
   ],
   [
    "Schreiben",
    "Formular und kurze Nachricht",
    "ca. 20 Min.",
    "15 P."
   ],
   [
    "Sprechen",
    "3 Teile · Aufnahme",
    "ca. 15 Min.",
    "15 P."
   ]
  ],
  "sections": [
   {
    "id": "hv",
    "label": "Hören",
    "short": "Hören",
    "title": "Hören",
    "minutes": 20,
    "intro": "3 Teile. 15 Aufgaben. 15 Punkte. Sie hören kurze Texte. Vor jedem Text haben Sie Zeit zum Lesen.",
    "plain": "Sie hören 3 Blöcke nacheinander. Vor jedem Text lesen Sie die Aufgaben. Dann starten Sie den Ton selbst.",
    "notice": "<b>Wichtig:</b> Teil 1 und Teil 3 hören Sie <b>zweimal</b>. Teil 2 hören Sie nur <b>einmal</b>. Sie können den Text nicht stoppen."
   },
   {
    "id": "lv",
    "label": "Lesen",
    "short": "Lesen",
    "title": "Lesen",
    "minutes": 25,
    "intro": "3 Teile. 15 Aufgaben. 15 Punkte. Sie lesen kurze Texte, Anzeigen und Schilder.",
    "plain": "Sie lesen kurze Texte und kreuzen an. Sie können die Aufgaben in jeder Reihenfolge machen.",
    "notice": "<b>Wichtig:</b> Wenn Sie diesen Teil beenden, können Sie nicht mehr zurück."
   },
   {
    "id": "sa",
    "label": "Schreiben",
    "short": "Schreiben",
    "title": "Schreiben",
    "minutes": 20,
    "intro": "Sie füllen ein Formular aus. Dann schreiben Sie eine kurze Nachricht. Zusammen 15 Punkte.",
    "plain": "Zuerst das Formular: 5 Wörter eintragen. Dann die Nachricht: etwa 30 Wörter.",
    "notice": "<b>Wichtig:</b> Ein Wörterbuch dürfen Sie nicht benutzen. Wenn die Zeit zu Ende ist, wird Ihr Text abgegeben."
   },
   {
    "id": "ma",
    "label": "Sprechen",
    "short": "Sprechen",
    "title": "Sprechen",
    "minutes": 15,
    "preparationMinutes": 10,
    "intro": "3 Teile. 15 Punkte. Sie stellen sich vor, Sie fragen nach Informationen, Sie bitten um etwas.",
    "plain": "Zuerst 10 Minuten zum Lesen und Notieren. Dann sprechen Sie dreimal und nehmen sich selbst auf.",
    "notice": "<b>Wichtig:</b> In der Prüfung sprechen Sie mit anderen Personen. Hier nehmen Sie sich selbst auf."
   }
  ],
  "blocks": [
   {
    "id": "hv1",
    "sectionId": "hv",
    "moduleId": "hv",
    "part": "Teil 1",
    "title": "Kurze Gespräche",
    "layout": "audioMC",
    "instructions": "Sie hören 6 kurze Texte. Was ist richtig? Kreuzen Sie an: <b>a</b>, <b>b</b> oder <b>c</b>. Sie hören jeden Text <b>zweimal</b>.",
    "plain": "Sie hören 6 kurze Texte. Zu jedem Text gibt es 1 Frage mit 3 Antworten. Nur 1 Antwort ist richtig.",
    "points": 1,
    "count": 6,
    "numberGroup": "hv",
    "textCount": 6,
    "readSeconds": 20,
    "pauseSeconds": 10,
    "plays": 2
   },
   {
    "id": "hv2",
    "sectionId": "hv",
    "moduleId": "hv",
    "part": "Teil 2",
    "title": "Durchsagen",
    "layout": "audioRF",
    "instructions": "Sie hören 4 Durchsagen. Ist der Satz richtig oder falsch? Kreuzen Sie an: <b>+</b> = richtig, <b>−</b> = falsch. Sie hören jeden Text nur <b>einmal</b>.",
    "plain": "Sie hören 4 Durchsagen. Zu jeder Durchsage gibt es 1 Satz. Stimmt der Satz? Dann +. Stimmt er nicht? Dann −.",
    "points": 1,
    "count": 4,
    "numberGroup": "hv",
    "textCount": 4,
    "readSeconds": 20,
    "pauseSeconds": 10,
    "plays": 1
   },
   {
    "id": "hv3",
    "sectionId": "hv",
    "moduleId": "hv",
    "part": "Teil 3",
    "title": "Ansagen am Telefon",
    "layout": "audioMC",
    "instructions": "Sie hören 5 Ansagen am Telefon. Was ist richtig? Kreuzen Sie an: <b>a</b>, <b>b</b> oder <b>c</b>. Sie hören jeden Text <b>zweimal</b>.",
    "plain": "Sie hören 5 Ansagen vom Anrufbeantworter. Zu jeder Ansage gibt es 1 Frage mit 3 Antworten.",
    "points": 1,
    "count": 5,
    "numberGroup": "hv",
    "textCount": 5,
    "readSeconds": 20,
    "pauseSeconds": 10,
    "plays": 2
   },
   {
    "id": "lv1",
    "sectionId": "lv",
    "moduleId": "lv",
    "part": "Teil 1",
    "title": "Kurze Texte",
    "layout": "textRF",
    "instructions": "Lesen Sie die 2 Texte. Ist der Satz richtig oder falsch? Kreuzen Sie an: <b>+</b> = richtig, <b>−</b> = falsch.",
    "plain": "Sie lesen 2 Texte. Danach kommen 5 Sätze. Stimmt der Satz zum Text? Dann +. Stimmt er nicht? Dann −.",
    "points": 1,
    "count": 5,
    "numberGroup": "lv"
   },
   {
    "id": "lv2",
    "sectionId": "lv",
    "moduleId": "lv",
    "part": "Teil 2",
    "title": "Anzeigen vergleichen",
    "layout": "adsAB",
    "instructions": "Lesen Sie die Situation. Dann lesen Sie 2 Anzeigen. Welche Anzeige passt? Kreuzen Sie an: <b>a</b> oder <b>b</b>.",
    "plain": "Lesen Sie die Situation. Dann die 2 Anzeigen. Klicken Sie auf a oder b.",
    "points": 1,
    "count": 5,
    "numberGroup": "lv"
   },
   {
    "id": "lv3",
    "sectionId": "lv",
    "moduleId": "lv",
    "part": "Teil 3",
    "title": "Schilder und Aushänge",
    "layout": "textRF",
    "instructions": "Lesen Sie die Schilder. Ist der Satz richtig oder falsch? Kreuzen Sie an: <b>+</b> = richtig, <b>−</b> = falsch.",
    "plain": "Sie sehen Schilder aus dem Alltag. Zu jedem Schild gibt es 1 Satz. Steht das wirklich auf dem Schild?",
    "points": 1,
    "count": 5,
    "numberGroup": "lv"
   },
   {
    "id": "sa1",
    "sectionId": "sa",
    "moduleId": "sa",
    "part": "Teil 1",
    "title": "Ein Formular ausfüllen",
    "layout": "formular",
    "instructions": "Lesen Sie den Text. Schreiben Sie 5 Wörter in das Formular. Ein Wort oder eine Zahl ist genug.",
    "plain": "Im Text stehen die Antworten. Schreiben Sie sie in die 5 Felder. Ein Wort oder eine Zahl reicht.",
    "points": 1,
    "count": 5,
    "numberGroup": "sa"
   },
   {
    "id": "sa2",
    "sectionId": "sa",
    "moduleId": "sa",
    "part": "Teil 2",
    "title": "Eine kurze Nachricht schreiben",
    "layout": "mitteilung",
    "instructions": "Schreiben Sie zu <b>allen 3 Punkten</b> 1 bis 2 Sätze. Zusammen etwa <b>30 Wörter</b>. Schreiben Sie auch eine Anrede und einen Gruß.",
    "plain": "Schreiben Sie zu jedem der 3 Punkte 1 bis 2 Sätze. Zusammen etwa 30 Wörter. Anrede und Gruß nicht vergessen.",
    "points": 10,
    "criteria": [
     {
      "name": "Inhalt",
      "describes": "Alle drei Punkte der Aufgabe sind genannt und verständlich.",
      "max": 4
     },
     {
      "name": "Kommunikative Gestaltung",
      "describes": "Anrede und Gruß sind vorhanden und passen zur Person.",
      "max": 3
     },
     {
      "name": "Sprachliche Richtigkeit",
      "describes": "Einfache Sätze sind so geschrieben, dass man sie gut versteht.",
      "max": 3
     }
    ],
    "words": {
     "min": 30,
     "max": 50
    },
    "fieldLabel": "Ihre Nachricht"
   },
   {
    "id": "ma1",
    "sectionId": "ma",
    "moduleId": "ma",
    "part": "Teil 1",
    "title": "Sich vorstellen",
    "layout": "speak",
    "instructions": "Stellen Sie sich vor. Sprechen Sie über die Wörter auf der Karte. Buchstabieren Sie dann Ihren Namen. Sagen Sie Ihre Telefonnummer.",
    "plain": "Sagen Sie: Name, Alter, Land, Wohnort, Sprachen, Beruf, Hobby. Dann buchstabieren Sie Ihren Namen und sagen Ihre Telefonnummer.",
    "points": 5,
    "prepSeconds": 60,
    "recordSeconds": 90,
    "speakingKind": "vorstellen"
   },
   {
    "id": "ma2",
    "sectionId": "ma",
    "moduleId": "ma",
    "part": "Teil 2",
    "title": "Um Informationen bitten",
    "layout": "speak",
    "instructions": "Auf der Karte stehen Wörter zu einem Thema. Machen Sie zu jedem Wort eine Frage. Antworten Sie auch auf die Fragen.",
    "plain": "Machen Sie zu jedem Wort auf der Karte eine Frage. Beispiel: Wort „Zimmer“ – „Wie viele Zimmer hat die Wohnung?“",
    "points": 5,
    "prepSeconds": 60,
    "recordSeconds": 120,
    "speakingKind": "gespraech"
   },
   {
    "id": "ma3",
    "sectionId": "ma",
    "moduleId": "ma",
    "part": "Teil 3",
    "title": "Eine Bitte formulieren",
    "layout": "speak",
    "instructions": "Auf der Karte stehen kleine Situationen. Bitten Sie höflich um etwas. Antworten Sie auch auf eine Bitte.",
    "plain": "Bitten Sie höflich um etwas. Beispiel: „Können Sie mir bitte helfen?“ Antworten Sie auch, wenn jemand Sie bittet.",
    "points": 5,
    "prepSeconds": 60,
    "recordSeconds": 120,
    "speakingKind": "bitte"
   }
  ],
  "scoring": {
   "total": 60,
   "pass": 36,
   "modules": [
    {
     "id": "hv",
     "name": "Hören",
     "max": 15,
     "source": "auto"
    },
    {
     "id": "lv",
     "name": "Lesen",
     "max": 15,
     "source": "auto"
    },
    {
     "id": "sa",
     "name": "Schreiben",
     "max": 15,
     "source": "marked"
    },
    {
     "id": "ma",
     "name": "Sprechen",
     "max": 15,
     "source": "marked"
    }
   ],
   "groups": [
    {
     "name": "Schriftliche Prüfung",
     "moduleIds": [
      "hv",
      "lv",
      "sa"
     ],
     "max": 45
    }
   ]
  }
 },
 "A2": {
  "name": "telc Deutsch A2",
  "subtitle": "Start Deutsch 2",
  "who": "Alltag und vertraute Themen: Termine, Einkauf, Arbeit, kurze Briefe.",
  "timeLine": "70 Min. schriftlich · ca. 15 Min. mündlich",
  "lede": "Hier üben Sie die telc-Prüfung Deutsch A2 am Computer. Der Test hat 4 Teile: Hören, Lesen, Schreiben und Sprechen. Aufbau, Zeit und Punkte sind wie in der echten Prüfung.",
  "rules": [
   "Die Aufgaben sind bei jedem Start neu gemischt.",
   "Ein Programm liest die Hörtexte vor. Vor jedem Text haben Sie Zeit zum Lesen.",
   "Ein Übersetzer funktioniert hier nicht. Der Test stoppt, wenn Sie einen benutzen.",
   "Ihren Text und Ihr Sprechen bewerten in der Prüfung Personen. Hier sehen Sie ein Beispiel und schätzen sich selbst ein."
  ],
  "passNote": "Bestanden ab 36 von 60 Punkten. Schriftlicher und mündlicher Teil werden zusammengezählt.",
  "rows": [
   [
    "Hören",
    "3 Teile · 15 Aufgaben",
    "ca. 20 Min.",
    "15 P."
   ],
   [
    "Lesen",
    "3 Teile · 15 Aufgaben",
    "50 Min. mit Schreiben",
    "15 P."
   ],
   [
    "Schreiben",
    "Formular und Brief (ca. 40 Wörter)",
    "mit Lesen",
    "15 P."
   ],
   [
    "Sprechen",
    "3 Teile · Aufnahme",
    "ca. 15 Min.",
    "15 P."
   ]
  ],
  "sections": [
   {
    "id": "hv",
    "label": "Hören",
    "short": "Hören",
    "title": "Hören",
    "minutes": 20,
    "intro": "3 Teile. 15 Aufgaben. 15 Punkte. Sie hören kurze Texte aus dem Alltag. Vor jedem Text haben Sie Zeit zum Lesen.",
    "plain": "Sie hören 3 Blöcke nacheinander. Vor jedem Text lesen Sie die Aufgaben. Dann starten Sie den Ton selbst.",
    "notice": "<b>Wichtig:</b> Teil 1 und Teil 3 hören Sie <b>zweimal</b>. Teil 2 hören Sie nur <b>einmal</b>. Sie können den Text nicht stoppen."
   },
   {
    "id": "lv_sa",
    "label": "Lesen & Schreiben",
    "short": "Lesen + Schreiben",
    "title": "Lesen und Schreiben",
    "minutes": 50,
    "intro": "Lesen: 3 Teile, 15 Aufgaben, 15 Punkte. Schreiben: ein Formular und eine kurze Mitteilung, 15 Punkte. Sie haben 50 Minuten für beides zusammen.",
    "plain": "Lesen und Schreiben zusammen in 50 Minuten. Teilen Sie sich die Zeit selbst ein.",
    "notice": "<b>Wichtig:</b> Wenn Sie diesen Teil beenden, können Sie nicht mehr zurück. Ein Wörterbuch dürfen Sie nicht benutzen."
   },
   {
    "id": "ma",
    "label": "Sprechen",
    "short": "Sprechen",
    "title": "Sprechen",
    "minutes": 15,
    "preparationMinutes": 10,
    "intro": "3 Teile. 15 Punkte. Sie stellen sich vor, Sie sprechen über ein Thema aus dem Alltag, und Sie machen zusammen einen Termin.",
    "plain": "Zuerst 10 Minuten zum Lesen und Notieren. Dann sprechen Sie dreimal und nehmen sich selbst auf.",
    "notice": "<b>Wichtig:</b> In der Prüfung sprechen Sie mit einer Partnerin oder einem Partner. Hier nehmen Sie sich selbst auf."
   }
  ],
  "blocks": [
   {
    "id": "hv1",
    "sectionId": "hv",
    "moduleId": "hv",
    "part": "Teil 1",
    "title": "Telefonnotizen ergänzen",
    "layout": "audioNotiz",
    "instructions": "Sie hören 2 Nachrichten auf dem Anrufbeantworter. Was fehlt in der Notiz? Schreiben Sie ein Wort oder eine Zahl in jede Lücke. Sie hören die Texte <b>zweimal</b>.",
    "plain": "Sie hören 2 Nachrichten vom Anrufbeantworter. In der Notiz daneben fehlen Wörter. Ein Wort oder eine Zahl reicht.",
    "points": 1,
    "count": 5,
    "numberGroup": "hv",
    "textCount": 2,
    "readSeconds": 20,
    "pauseSeconds": 10,
    "plays": 2
   },
   {
    "id": "hv2",
    "sectionId": "hv",
    "moduleId": "hv",
    "part": "Teil 2",
    "title": "Durchsagen und Ansagen",
    "layout": "audioMC",
    "instructions": "Sie hören 5 kurze Texte, zum Beispiel am Bahnhof oder am Telefon. Was ist richtig? Kreuzen Sie an: <b>a</b>, <b>b</b> oder <b>c</b>. Sie hören jeden Text nur <b>einmal</b>.",
    "plain": "Sie hören 5 kurze Texte. Zu jedem Text gibt es 1 Frage mit 3 Antworten. Sie hören jeden Text nur einmal.",
    "points": 1,
    "count": 5,
    "numberGroup": "hv",
    "textCount": 5,
    "readSeconds": 20,
    "pauseSeconds": 9,
    "plays": 1
   },
   {
    "id": "hv3",
    "sectionId": "hv",
    "moduleId": "hv",
    "part": "Teil 3",
    "title": "Kurze Gespräche zuordnen",
    "layout": "audioMatch",
    "instructions": "Sie hören 5 kurze Gespräche. Welche Aussage passt zu welchem Gespräch? Wählen Sie einen Buchstaben <b>a</b> bis <b>i</b>. Jede Aussage passt nur einmal. Sie brauchen nicht alle Aussagen. Sie hören die Texte <b>zweimal</b>.",
    "plain": "5 Gespräche, 9 Aussagen von a bis i. Welche Aussage passt zu welchem Gespräch? Jede Aussage nur einmal. 4 Aussagen bleiben übrig.",
    "points": 1,
    "count": 5,
    "numberGroup": "hv",
    "textCount": 5,
    "readSeconds": 20,
    "pauseSeconds": 9,
    "plays": 2,
    "bankTitle": "Auswahl a–i"
   },
   {
    "id": "lv1",
    "sectionId": "lv_sa",
    "moduleId": "lv",
    "part": "Teil 1",
    "title": "Wegweiser lesen",
    "layout": "infoMC",
    "instructions": "Lesen Sie den Wegweiser. Wohin gehen Sie? Kreuzen Sie an: <b>a</b>, <b>b</b> oder <b>c</b>.",
    "plain": "Auf dem Wegweiser stehen Räume und Pfeile. Wohin gehen Sie? Klicken Sie auf a, b oder c.",
    "points": 1,
    "count": 5,
    "numberGroup": "lv"
   },
   {
    "id": "lv2",
    "sectionId": "lv_sa",
    "moduleId": "lv",
    "part": "Teil 2",
    "title": "Kurze Texte verstehen",
    "layout": "textRF",
    "instructions": "Lesen Sie die Texte. Ist der Satz richtig oder falsch? Kreuzen Sie an: <b>+</b> = richtig, <b>−</b> = falsch.",
    "plain": "Sie lesen kurze Texte. Danach kommen Sätze dazu. Stimmt der Satz zum Text? Dann +. Stimmt er nicht? Dann −.",
    "points": 1,
    "count": 5,
    "numberGroup": "lv"
   },
   {
    "id": "lv3",
    "sectionId": "lv_sa",
    "moduleId": "lv",
    "part": "Teil 3",
    "title": "Anzeigen zuordnen",
    "layout": "ads",
    "instructions": "Lesen Sie die 5 Situationen und die 8 Anzeigen. Welche Anzeige passt zu welcher Situation? Jede Anzeige passt nur einmal. Passt keine Anzeige? Dann wählen Sie <b>x</b>.",
    "plain": "5 Situationen, 8 Anzeigen. Jede Anzeige nur einmal. Passt keine Anzeige, wählen Sie x.",
    "points": 1,
    "count": 5,
    "numberGroup": "lv"
   },
   {
    "id": "sa1",
    "sectionId": "lv_sa",
    "moduleId": "sa",
    "part": "Teil 1",
    "title": "Ein Formular ausfüllen",
    "layout": "formular",
    "instructions": "Lesen Sie den Text. Schreiben Sie 5 Wörter in das Formular. Ein Wort oder eine Zahl ist genug.",
    "plain": "Im Text stehen die Antworten. Schreiben Sie sie in die 5 Felder. Ein Wort oder eine Zahl reicht.",
    "points": 1,
    "count": 5,
    "numberGroup": "sa"
   },
   {
    "id": "sa2",
    "sectionId": "lv_sa",
    "moduleId": "sa",
    "part": "Teil 2",
    "title": "Eine kurze Mitteilung schreiben",
    "layout": "mitteilung",
    "instructions": "Wählen Sie <b>3</b> von den 4 Punkten. Schreiben Sie zu jedem Punkt 1 bis 2 Sätze. Zusammen etwa <b>40 Wörter</b>. Schreiben Sie auch eine Anrede und einen Gruß.",
    "plain": "Sie sehen 4 Punkte. Wählen Sie 3 davon. Schreiben Sie zu jedem 1 bis 2 Sätze, zusammen etwa 40 Wörter.",
    "points": 10,
    "criteria": [
     {
      "name": "Inhalt",
      "describes": "Alle drei gewählten Punkte sind bearbeitet und verständlich ausgeführt.",
      "max": 4
     },
     {
      "name": "Kommunikative Gestaltung",
      "describes": "Anrede, Gruß und Ton passen zur Situation und zur Empfängerin oder zum Empfänger.",
      "max": 3
     },
     {
      "name": "Sprachliche Richtigkeit",
      "describes": "Wortschatz und Satzbau reichen für die Aufgabe; Fehler stören das Verständnis nicht.",
      "max": 3
     }
    ],
    "words": {
     "min": 40,
     "max": 70
    },
    "choose": 3,
    "fieldLabel": "Ihre Mitteilung"
   },
   {
    "id": "ma1",
    "sectionId": "ma",
    "moduleId": "ma",
    "part": "Teil 1",
    "title": "Sich vorstellen",
    "layout": "speak",
    "instructions": "Stellen Sie sich vor. Sprechen Sie über die Wörter auf der Karte. Danach beantworten Sie 2 Fragen. Sprechzeit: etwa <b>anderthalb Minuten</b>.",
    "plain": "Sagen Sie etwas zu jedem Wort auf der Karte. Danach kommen 2 Fragen. Sie nehmen sich selbst auf.",
    "points": 3,
    "prepSeconds": 60,
    "recordSeconds": 90,
    "speakingKind": "vorstellen"
   },
   {
    "id": "ma2",
    "sectionId": "ma",
    "moduleId": "ma",
    "part": "Teil 2",
    "title": "Ein Alltagsgespräch führen",
    "layout": "speak",
    "instructions": "Auf der Karte stehen Stichwörter zu einem Thema. Stellen Sie Fragen und antworten Sie. Sprechen Sie in ganzen Sätzen. Sprechzeit: etwa <b>zweieinhalb Minuten</b>.",
    "plain": "Zu jedem Wort auf der Karte: eine Frage stellen und die Frage auch beantworten. Sprechen Sie in ganzen Sätzen.",
    "points": 6,
    "prepSeconds": 90,
    "recordSeconds": 150,
    "speakingKind": "gespraech"
   },
   {
    "id": "ma3",
    "sectionId": "ma",
    "moduleId": "ma",
    "part": "Teil 3",
    "title": "Gemeinsam etwas aushandeln",
    "layout": "speak",
    "instructions": "Suchen Sie zusammen einen Termin. Machen Sie Vorschläge. Sagen Sie auch ab, wenn ein Tag nicht passt. Finden Sie am Ende einen Termin. Sprechzeit: etwa <b>zweieinhalb Minuten</b>.",
    "plain": "Sie suchen einen Termin. Sagen Sie: Wann können Sie? Wann können Sie nicht? Einigen Sie sich am Ende auf einen Tag.",
    "points": 6,
    "prepSeconds": 90,
    "recordSeconds": 150,
    "speakingKind": "planung"
   }
  ],
  "scoring": {
   "total": 60,
   "pass": 36,
   "modules": [
    {
     "id": "hv",
     "name": "Hören",
     "max": 15,
     "source": "auto"
    },
    {
     "id": "lv",
     "name": "Lesen",
     "max": 15,
     "source": "auto"
    },
    {
     "id": "sa",
     "name": "Schreiben",
     "max": 15,
     "source": "marked"
    },
    {
     "id": "ma",
     "name": "Sprechen",
     "max": 15,
     "source": "marked"
    }
   ],
   "groups": [
    {
     "name": "Schriftliche Prüfung",
     "moduleIds": [
      "hv",
      "lv",
      "sa"
     ],
     "max": 45
    }
   ]
  }
 },
 "B1": {
  "name": "telc Deutsch B1",
  "subtitle": "Zertifikat Deutsch",
  "who": "Selbstständige Sprachverwendung: Beruf, Ausbildung, Behörden, Meinung äußern.",
  "timeLine": "140 Min. schriftlich · ca. 15 Min. mündlich",
  "lede": "Ein vollständiger Übungsdurchgang im Format der telc-Prüfung Deutsch B1: Aufbau, Aufgabentypen, Zeiten und Bewertung folgen der offiziellen Prüfung.",
  "rules": [
   "Aufgaben, Texte und Antwortreihenfolge werden bei jedem Start neu gemischt.",
   "Hörtexte werden vom Programm vorgelesen. Vor jedem Text gibt es Zeit zum Lesen der Aufgaben.",
   "Übersetzungsprogramme sind gesperrt. Wird eine Übersetzung erkannt, hält die Prüfung an.",
   "Brief und Sprechteile werden im Original von Prüfenden bewertet. Hier erhalten Sie eine Auswertung, eine Musterlösung und eine Selbsteinschätzung."
  ],
  "passNote": "Bestanden ab 180 von 300 Punkten, wobei der schriftliche Teil mindestens 135 von 225 und der mündliche Teil mindestens 45 von 75 Punkten erreichen muss.",
  "rows": [
   [
    "Leseverstehen",
    "3 Teile · 20 Aufgaben",
    "90 Min. gemeinsam",
    "75 P."
   ],
   [
    "Sprachbausteine",
    "2 Teile · 20 Aufgaben",
    "mit Leseverstehen",
    "30 P."
   ],
   [
    "Hörverstehen",
    "3 Teile · 20 Aufgaben",
    "ca. 22 Min.",
    "75 P."
   ],
   [
    "Schriftlicher Ausdruck",
    "1 E-Mail · 4 Leitpunkte",
    "30 Min.",
    "45 P."
   ],
   [
    "Mündlicher Ausdruck",
    "3 Teile · Aufnahme",
    "ca. 15 Min.",
    "75 P."
   ]
  ],
  "sections": [
   {
    "id": "lv_sb",
    "label": "Lesen & Sprachbausteine",
    "short": "Lesen + SB",
    "title": "Leseverstehen und Sprachbausteine",
    "minutes": 90,
    "intro": "Fünf Aufgabenblöcke, 40 Aufgaben, 105 Punkte. Sie teilen sich die Zeit selbst ein und können innerhalb dieses Prüfungsteils frei zwischen den Aufgaben wechseln.",
    "plain": "Sie haben 90 Minuten für alle 40 Aufgaben. Die Reihenfolge wählen Sie selbst und Sie können jederzeit zurückgehen.",
    "notice": "<b>Wichtig:</b> Sobald Sie diesen Prüfungsteil abschließen, können Sie nicht mehr zu den Aufgaben 1–40 zurückkehren."
   },
   {
    "id": "hv",
    "label": "Hörverstehen",
    "short": "Hören",
    "title": "Hörverstehen",
    "minutes": 22,
    "intro": "Drei Blöcke, 20 Aufgaben, 75 Punkte. Die Hörtexte werden vom Programm vorgelesen. Lesen Sie die Aufgaben, bevor Sie die Wiedergabe starten.",
    "plain": "Lesen Sie zuerst die Aufgaben. Dann starten Sie den Ton. Der Ton läuft ohne Pause bis zum Ende.",
    "notice": "<b>Wichtig:</b> Teil 1 und Teil 2 hören Sie nur <b>einmal</b>, Teil 3 <b>zweimal</b>. Ein begonnener Hörtext lässt sich nicht anhalten."
   },
   {
    "id": "sa",
    "label": "Schriftlicher Ausdruck",
    "short": "Schreiben",
    "title": "Schriftlicher Ausdruck",
    "minutes": 30,
    "intro": "Eine E-Mail zu vier Leitpunkten, 45 Punkte. Ihr Text wird im Original von zwei Prüfenden bewertet.",
    "plain": "Sie schreiben eine E-Mail. In der Aufgabe stehen 4 Punkte. Schreiben Sie zu jedem Punkt ein bis zwei Sätze.",
    "notice": "<b>Hinweis:</b> Nach Ablauf der 30 Minuten wird der Text automatisch abgegeben. Er wird laufend gespeichert."
   },
   {
    "id": "ma",
    "label": "Mündlicher Ausdruck",
    "short": "Sprechen",
    "title": "Mündlicher Ausdruck",
    "minutes": 15,
    "preparationMinutes": 20,
    "intro": "Drei Teile, 75 Punkte. Zuerst 20 Minuten Vorbereitung für alle drei Aufgaben, danach die Prüfung selbst. In der echten Prüfung sprechen Sie zu zweit vor zwei Prüfenden; hier nehmen Sie Ihre Beiträge selbst auf.",
    "plain": "Zuerst 20 Minuten: alle drei Aufgaben lesen und Notizen machen. Dann sprechen Sie dreimal und nehmen sich dabei auf. Ihre Notizen bleiben stehen.",
    "notice": "<b>Hinweis:</b> Jeder Teil hat eine Vorbereitungszeit. Notizen dürfen Sie machen, ablesen sollten Sie nicht."
   }
  ],
  "blocks": [
   {
    "id": "lv1",
    "sectionId": "lv_sb",
    "moduleId": "lv",
    "part": "Teil 1",
    "title": "Überschriften zuordnen",
    "layout": "match",
    "instructions": "Lesen Sie zuerst die fünf kurzen Texte und dann die zehn Überschriften. Entscheiden Sie, welche Überschrift <b>(a–j)</b> am besten zu welchem Text <b>(1–5)</b> passt. Jede Überschrift kann nur einmal verwendet werden. Nicht alle Überschriften passen.",
    "plain": "5 Texte, 10 Überschriften. Suchen Sie zu jedem Text die passende Überschrift. Jede Überschrift nur einmal. 5 Überschriften bleiben übrig.",
    "points": 3.75,
    "count": 5
   },
   {
    "id": "lv2",
    "sectionId": "lv_sb",
    "moduleId": "lv",
    "part": "Teil 2",
    "title": "Detailverstehen",
    "layout": "mc",
    "instructions": "Lesen Sie den Text und die Aufgaben <b>6–10</b> dazu. Wählen Sie bei jeder Aufgabe die richtige Lösung <b>a</b>, <b>b</b> oder <b>c</b>.",
    "plain": "Ein langer Text, 5 Fragen. Kreuzen Sie bei jeder Frage a, b oder c an.",
    "points": 3.75,
    "count": 5
   },
   {
    "id": "lv3",
    "sectionId": "lv_sb",
    "moduleId": "lv",
    "part": "Teil 3",
    "title": "Anzeigen zuordnen",
    "layout": "ads",
    "instructions": "Lesen Sie die zehn Situationen <b>11–20</b> und die zwölf Anzeigen <b>a–l</b>. Welche Anzeige passt zu welcher Situation? Jede Anzeige kann nur einmal verwendet werden. Wenn es zu einer Situation keine passende Anzeige gibt, wählen Sie <b>x</b>.",
    "plain": "10 Situationen, 12 Anzeigen. Suchen Sie zu jeder Situation die passende Anzeige. Jede Anzeige nur einmal. Passt keine Anzeige, wählen Sie x.",
    "points": 3.75,
    "count": 10
   },
   {
    "id": "sb1",
    "sectionId": "lv_sb",
    "moduleId": "sb",
    "part": "Teil 1",
    "title": "Grammatik im Text",
    "layout": "cloze3",
    "instructions": "Lesen Sie den folgenden Text und entscheiden Sie, welches Wort <b>(a, b</b> oder <b>c)</b> in die Lücken <b>21–30</b> passt. Sie können den Text zuerst ganz lesen.",
    "plain": "Ein Text mit 10 Lücken. Wählen Sie für jede Lücke a, b oder c.",
    "points": 1.5,
    "count": 10
   },
   {
    "id": "sb2",
    "sectionId": "lv_sb",
    "moduleId": "sb",
    "part": "Teil 2",
    "title": "Wortschatz im Text",
    "layout": "clozeBank",
    "instructions": "Lesen Sie den Aushang und füllen Sie die Lücken <b>31–40</b>. Wählen Sie für jede Lücke ein Wort aus der Liste <b>a–o</b>. Jedes Wort passt nur einmal. Nicht alle Wörter werden gebraucht.",
    "plain": "Ein Text mit 10 Lücken. Wählen Sie für jede Lücke ein Wort aus der Liste. Jedes Wort nur einmal. Einige Wörter bleiben übrig.",
    "points": 1.5,
    "count": 10
   },
   {
    "id": "hv1",
    "sectionId": "hv",
    "moduleId": "hv",
    "part": "Teil 1",
    "title": "Kurze Ansagen",
    "layout": "audioRF",
    "instructions": "Sie hören fünf kurze Ansagen. Zu jeder Ansage lösen Sie eine Aufgabe. Entscheiden Sie, ob die Aussage <b>richtig</b> oder <b>falsch</b> ist. Sie hören die Texte <b>einmal</b>. Lesen Sie zuerst die Aufgaben 41–45.",
    "plain": "5 kurze Ansagen, 5 Aussagen. Ist die Aussage richtig oder falsch? Sie hören jede Ansage nur einmal. Lesen Sie die Aufgaben vorher.",
    "points": 3.75,
    "count": 5,
    "textCount": 5,
    "readSeconds": 15,
    "pauseSeconds": 6,
    "plays": 1
   },
   {
    "id": "hv2",
    "sectionId": "hv",
    "moduleId": "hv",
    "part": "Teil 2",
    "title": "Radiogespräch",
    "layout": "audioRF",
    "instructions": "Sie hören ein Gespräch aus dem Radio. Dazu lösen Sie zehn Aufgaben. Entscheiden Sie, ob die Aussagen <b>46–55</b> richtig oder falsch sind. Sie hören den Text <b>einmal</b>. Lesen Sie jetzt zuerst die Aufgaben 46–55.",
    "plain": "Ein Gespräch aus dem Radio, 10 Aussagen. Richtig oder falsch? Sie hören das Gespräch nur einmal. Lesen Sie die Aufgaben vorher.",
    "points": 3.75,
    "count": 10,
    "textCount": 1,
    "readSeconds": 15,
    "pauseSeconds": 6,
    "plays": 1
   },
   {
    "id": "hv3",
    "sectionId": "hv",
    "moduleId": "hv",
    "part": "Teil 3",
    "title": "Kurze Gespräche",
    "layout": "audioRF",
    "instructions": "Sie hören fünf kurze Texte aus dem Alltag. Entscheiden Sie, ob die Aussagen <b>56–60</b> richtig oder falsch sind. Sie hören die Texte <b>zweimal</b>.",
    "plain": "5 kurze Texte, 5 Aussagen. Richtig oder falsch? Sie hören die Texte zweimal.",
    "points": 3.75,
    "count": 5,
    "textCount": 1,
    "readSeconds": 15,
    "pauseSeconds": 6,
    "plays": 2
   },
   {
    "id": "sa",
    "sectionId": "sa",
    "moduleId": "sa",
    "part": "Brief",
    "title": "Eine E-Mail schreiben",
    "layout": "write",
    "instructions": "Sie haben <b>30 Minuten</b> Zeit. Schreiben Sie zu jedem der vier Leitpunkte ein bis zwei Sätze. Achten Sie auf Anrede, Reihenfolge und Grußformel. Empfohlener Umfang: etwa 150 Wörter.",
    "plain": "Schreiben Sie eine E-Mail, etwa 150 Wörter. Zu jedem der 4 Punkte ein bis zwei Sätze. Anrede und Gruß nicht vergessen. Sie haben 30 Minuten.",
    "points": 45,
    "criteria": [
     {
      "name": "Inhalt",
      "describes": "Alle vier Leitpunkte sind bearbeitet und verständlich ausgeführt.",
      "max": 15
     },
     {
      "name": "Kommunikative Gestaltung",
      "describes": "Passende Anrede und Grußformel, angemessen förmlicher Ton, sinnvolle Reihenfolge und Verknüpfung der Sätze.",
      "max": 15
     },
     {
      "name": "Formale Richtigkeit",
      "describes": "Wortschatz, Satzbau, Verbformen und Rechtschreibung stören das Verständnis nicht.",
      "max": 15
     }
    ]
   },
   {
    "id": "ma1",
    "sectionId": "ma",
    "moduleId": "ma",
    "part": "Teil 1",
    "title": "Kontaktaufnahme",
    "layout": "speak",
    "instructions": "Im mündlichen Teil sprechen Sie mit einer Partnerin oder einem Partner. Hier sprechen Sie allein auf Aufnahme. Stellen Sie sich kurz vor: etwa <b>eine Minute</b> Sprechzeit.",
    "plain": "Stellen Sie sich vor: Name, Wohnort, Arbeit oder Studium, Deutschlernen, Hobbys, Ziel. Etwa 1 Minute sprechen.",
    "points": 25,
    "prepSeconds": 120,
    "recordSeconds": 90,
    "speakingKind": "gespraech"
   },
   {
    "id": "ma2",
    "sectionId": "ma",
    "moduleId": "ma",
    "part": "Teil 2",
    "title": "Gespräch über ein Thema",
    "layout": "speak",
    "instructions": "Sie sprechen über ein vorgegebenes Thema: erst Ihre eigenen Erfahrungen, dann Vor- und Nachteile, dann Ihre Meinung. Sprechzeit etwa <b>zweieinhalb Minuten</b>.",
    "plain": "Sprechen Sie über das Thema. Erst Ihre eigene Erfahrung, dann Vorteile und Nachteile, dann Ihre Meinung. Etwa 2,5 Minuten sprechen.",
    "points": 25,
    "prepSeconds": 180,
    "recordSeconds": 150,
    "speakingKind": "diskussion"
   },
   {
    "id": "ma3",
    "sectionId": "ma",
    "moduleId": "ma",
    "part": "Teil 3",
    "title": "Gemeinsam etwas planen",
    "layout": "speak",
    "instructions": "Sie planen mit Ihrer Partnerin oder Ihrem Partner eine gemeinsame Aufgabe. Machen Sie Vorschläge, reagieren Sie darauf und einigen Sie sich. Sprechzeit etwa <b>drei Minuten</b>.",
    "plain": "Planen Sie etwas zusammen. Machen Sie Vorschläge und sagen Sie am Ende, wofür Sie sich entscheiden. Etwa 3 Minuten sprechen.",
    "points": 25,
    "prepSeconds": 180,
    "recordSeconds": 180,
    "speakingKind": "planung"
   }
  ],
  "scoring": {
   "total": 300,
   "pass": 180,
   "modules": [
    {
     "id": "lv",
     "name": "Leseverstehen",
     "max": 75,
     "source": "auto"
    },
    {
     "id": "sb",
     "name": "Sprachbausteine",
     "max": 30,
     "source": "auto"
    },
    {
     "id": "hv",
     "name": "Hörverstehen",
     "max": 75,
     "source": "auto"
    },
    {
     "id": "sa",
     "name": "Schriftlicher Ausdruck",
     "max": 45,
     "source": "marked"
    },
    {
     "id": "ma",
     "name": "Mündlicher Ausdruck",
     "max": 75,
     "source": "marked"
    }
   ],
   "groups": [
    {
     "name": "Schriftliche Prüfung gesamt",
     "moduleIds": [
      "lv",
      "sb",
      "hv",
      "sa"
     ],
     "max": 225,
     "min": 135
    },
    {
     "name": "Mündliche Prüfung",
     "moduleIds": [
      "ma"
     ],
     "max": 75,
     "min": 45
    }
   ]
  }
 },
 "B2": {
  "name": "telc Deutsch B2",
  "subtitle": "für Studium und Beruf",
  "who": "Klare Sprache zu abstrakten Themen: diskutieren, begründen, Fachtexte lesen.",
  "timeLine": "140 Min. schriftlich · ca. 15 Min. mündlich",
  "lede": "Ein vollständiger Übungsdurchgang im Format der telc-Prüfung Deutsch B2: Aufbau, Aufgabentypen, Zeiten und Bewertung folgen der offiziellen Prüfung.",
  "rules": [
   "Aufgaben, Texte und Antwortreihenfolge werden bei jedem Start neu gemischt.",
   "Hörtexte werden vom Programm vorgelesen. Auf dieser Stufe hören Sie jeden Text nur einmal.",
   "Übersetzungsprogramme sind gesperrt. Wird eine Übersetzung erkannt, hält die Prüfung an.",
   "Brief und Sprechteile werden im Original von Prüfenden bewertet. Hier erhalten Sie eine Auswertung, eine Musterlösung und eine Selbsteinschätzung."
  ],
  "passNote": "Bestanden ab 180 von 300 Punkten, wobei der schriftliche Teil mindestens 135 von 225 und der mündliche Teil mindestens 45 von 75 Punkten erreichen muss.",
  "rows": [
   [
    "Leseverstehen",
    "3 Teile · 20 Aufgaben",
    "90 Min. gemeinsam",
    "75 P."
   ],
   [
    "Sprachbausteine",
    "2 Teile · 20 Aufgaben",
    "mit Leseverstehen",
    "30 P."
   ],
   [
    "Hörverstehen",
    "3 Teile · 20 Aufgaben",
    "ca. 20 Min.",
    "75 P."
   ],
   [
    "Schriftlicher Ausdruck",
    "1 Brief · Wahl aus zwei Themen",
    "30 Min.",
    "45 P."
   ],
   [
    "Mündlicher Ausdruck",
    "3 Teile · Aufnahme",
    "ca. 15 Min.",
    "75 P."
   ]
  ],
  "sections": [
   {
    "id": "lv_sb",
    "label": "Lesen & Sprachbausteine",
    "short": "Lesen + SB",
    "title": "Leseverstehen und Sprachbausteine",
    "minutes": 90,
    "intro": "Fünf Aufgabenblöcke, 40 Aufgaben, 105 Punkte. Sie teilen sich die Zeit selbst ein und können innerhalb dieses Prüfungsteils frei zwischen den Aufgaben wechseln.",
    "plain": "Sie haben 90 Minuten für alle 40 Aufgaben. Die Reihenfolge wählen Sie selbst und Sie können jederzeit zurückgehen.",
    "notice": "<b>Wichtig:</b> Sobald Sie diesen Prüfungsteil abschließen, können Sie nicht mehr zu den Aufgaben 1–40 zurückkehren."
   },
   {
    "id": "hv",
    "label": "Hörverstehen",
    "short": "Hören",
    "title": "Hörverstehen",
    "minutes": 20,
    "intro": "Drei Blöcke, 20 Aufgaben, 75 Punkte. Die Hörtexte werden vom Programm vorgelesen. Lesen Sie die Aufgaben, bevor Sie die Wiedergabe starten.",
    "plain": "Lesen Sie zuerst die Aufgaben. Dann starten Sie den Ton. Jeden Text hören Sie nur einmal.",
    "notice": "<b>Wichtig:</b> Auf der Stufe B2 hören Sie jeden Text nur <b>einmal</b>. Eine begonnene Wiedergabe lässt sich nicht anhalten."
   },
   {
    "id": "sa",
    "label": "Schriftlicher Ausdruck",
    "short": "Schreiben",
    "title": "Schriftlicher Ausdruck",
    "minutes": 30,
    "intro": "Ein Brief zu einem von zwei Themen, 45 Punkte. Ihr Text wird im Original von zwei Prüfenden bewertet.",
    "plain": "Zwei Themen stehen zur Wahl. Nehmen Sie eines und schreiben Sie nur dazu, etwa 200 Wörter.",
    "notice": "<b>Hinweis:</b> Wählen Sie eines der beiden Themen und bearbeiten Sie nur dieses. Nach Ablauf der 30 Minuten wird der Text automatisch abgegeben."
   },
   {
    "id": "ma",
    "label": "Mündlicher Ausdruck",
    "short": "Sprechen",
    "title": "Mündlicher Ausdruck",
    "minutes": 15,
    "preparationMinutes": 20,
    "intro": "Drei Teile, 75 Punkte: über Erfahrungen sprechen, diskutieren, gemeinsam etwas planen. Zuerst 20 Minuten Vorbereitung für alle drei Aufgaben, danach die Prüfung selbst.",
    "plain": "Zuerst 20 Minuten: alle drei Aufgaben lesen und Notizen machen. Dann sprechen Sie dreimal. Notizen sind erlaubt, ablesen nicht.",
    "notice": "<b>Hinweis:</b> Jeder Teil hat eine Vorbereitungszeit. Notizen dürfen Sie machen, ablesen sollten Sie nicht."
   }
  ],
  "blocks": [
   {
    "id": "lv1",
    "sectionId": "lv_sb",
    "moduleId": "lv",
    "part": "Teil 1",
    "title": "Überschriften zuordnen",
    "layout": "match",
    "instructions": "Lesen Sie zuerst die fünf Texte und dann die zehn Überschriften. Entscheiden Sie, welche Überschrift <b>(a–j)</b> am besten zu welchem Text <b>(1–5)</b> passt. Jede Überschrift kann nur einmal verwendet werden. Nicht alle Überschriften passen.",
    "plain": "5 Texte, 10 Überschriften. Suchen Sie zu jedem Text die passende Überschrift. Jede Überschrift nur einmal. 5 Überschriften bleiben übrig.",
    "points": 3.75,
    "count": 5
   },
   {
    "id": "lv2",
    "sectionId": "lv_sb",
    "moduleId": "lv",
    "part": "Teil 2",
    "title": "Detailverstehen",
    "layout": "mc",
    "instructions": "Lesen Sie den Text und die Aufgaben <b>6–10</b> dazu. Wählen Sie bei jeder Aufgabe die richtige Lösung <b>a</b>, <b>b</b> oder <b>c</b>.",
    "plain": "Ein langer Text, 5 Fragen. Kreuzen Sie bei jeder Frage a, b oder c an.",
    "points": 3.75,
    "count": 5
   },
   {
    "id": "lv3",
    "sectionId": "lv_sb",
    "moduleId": "lv",
    "part": "Teil 3",
    "title": "Anzeigen zuordnen",
    "layout": "ads",
    "instructions": "Lesen Sie die zehn Situationen <b>11–20</b> und die zwölf Anzeigen <b>a–l</b>. Welche Anzeige passt zu welcher Situation? Jede Anzeige kann nur einmal verwendet werden. Wenn es zu einer Situation keine passende Anzeige gibt, wählen Sie <b>x</b>.",
    "plain": "10 Situationen, 12 Anzeigen. Suchen Sie zu jeder Situation die passende Anzeige. Jede Anzeige nur einmal. Passt keine Anzeige, wählen Sie x.",
    "points": 3.75,
    "count": 10
   },
   {
    "id": "sb1",
    "sectionId": "lv_sb",
    "moduleId": "sb",
    "part": "Teil 1",
    "title": "Grammatik im Text",
    "layout": "cloze3",
    "instructions": "Lesen Sie den folgenden Text und entscheiden Sie, welches Wort <b>(a, b</b> oder <b>c)</b> in die Lücken <b>21–30</b> passt. Sie können den Text zuerst ganz lesen.",
    "plain": "Ein Text mit 10 Lücken. Wählen Sie für jede Lücke a, b oder c.",
    "points": 1.5,
    "count": 10
   },
   {
    "id": "sb2",
    "sectionId": "lv_sb",
    "moduleId": "sb",
    "part": "Teil 2",
    "title": "Wortschatz im Text",
    "layout": "clozeBank",
    "instructions": "Lesen Sie den Text und füllen Sie die Lücken <b>31–40</b>. Wählen Sie für jede Lücke ein Wort aus der Liste <b>a–o</b>. Jedes Wort passt nur einmal. Nicht alle Wörter werden gebraucht.",
    "plain": "Ein Text mit 10 Lücken. Wählen Sie für jede Lücke ein Wort aus der Liste. Jedes Wort nur einmal. Einige Wörter bleiben übrig.",
    "points": 1.5,
    "count": 10
   },
   {
    "id": "hv1",
    "sectionId": "hv",
    "moduleId": "hv",
    "part": "Teil 1",
    "title": "Nachrichtensendung",
    "layout": "audioRF",
    "instructions": "Sie hören eine Nachrichtensendung mit fünf Meldungen. Entscheiden Sie, ob die Aussagen <b>41–45</b> richtig oder falsch sind. Sie hören den Text <b>einmal</b>. Lesen Sie zuerst die Aufgaben.",
    "plain": "Eine Nachrichtensendung, 5 Aussagen. Richtig oder falsch? Sie hören die Sendung nur einmal. Lesen Sie die Aufgaben vorher.",
    "points": 3.75,
    "count": 5,
    "textCount": 5,
    "readSeconds": 15,
    "pauseSeconds": 6,
    "plays": 1
   },
   {
    "id": "hv2",
    "sectionId": "hv",
    "moduleId": "hv",
    "part": "Teil 2",
    "title": "Gespräch",
    "layout": "audioRF",
    "instructions": "Sie hören ein Gespräch. Dazu lösen Sie zehn Aufgaben. Entscheiden Sie, ob die Aussagen <b>46–55</b> richtig oder falsch sind. Sie hören den Text <b>einmal</b>. Lesen Sie jetzt zuerst die Aufgaben.",
    "plain": "Ein Gespräch, 10 Aussagen. Richtig oder falsch? Sie hören das Gespräch nur einmal. Lesen Sie die Aufgaben vorher.",
    "points": 3.75,
    "count": 10,
    "textCount": 1,
    "readSeconds": 15,
    "pauseSeconds": 6,
    "plays": 1
   },
   {
    "id": "hv3",
    "sectionId": "hv",
    "moduleId": "hv",
    "part": "Teil 3",
    "title": "Kurze Äußerungen",
    "layout": "audioRF",
    "instructions": "Sie hören fünf kurze Äußerungen zu einem Thema. Entscheiden Sie, ob die Aussagen <b>56–60</b> richtig oder falsch sind. Sie hören die Texte <b>einmal</b>.",
    "plain": "5 kurze Äußerungen, 5 Aussagen. Richtig oder falsch? Sie hören jede Äußerung nur einmal.",
    "points": 3.75,
    "count": 5,
    "textCount": 5,
    "readSeconds": 15,
    "pauseSeconds": 6,
    "plays": 1
   },
   {
    "id": "sa",
    "sectionId": "sa",
    "moduleId": "sa",
    "part": "Brief",
    "title": "Einen Brief schreiben",
    "layout": "write",
    "instructions": "Sie haben <b>30 Minuten</b> Zeit. Wählen Sie <b>eines</b> der beiden Themen und bearbeiten Sie alle vier Leitpunkte. Empfohlener Umfang: etwa 200 Wörter.",
    "plain": "Wählen Sie eines der 2 Themen. Schreiben Sie etwa 200 Wörter zu allen 4 Punkten. Sie haben 30 Minuten.",
    "points": 45,
    "criteria": [
     {
      "name": "Inhalt",
      "describes": "Das gewählte Thema ist vollständig bearbeitet, alle Leitpunkte sind ausgeführt und begründet.",
      "max": 15
     },
     {
      "name": "Kommunikative Gestaltung",
      "describes": "Textsorte, Register und Aufbau passen zur Aufgabe; die Gedanken sind klar verknüpft.",
      "max": 15
     },
     {
      "name": "Formale Richtigkeit",
      "describes": "Wortschatz, Satzbau und Rechtschreibung sind auf B2-Niveau sicher; Fehler stören das Verständnis nicht.",
      "max": 15
     }
    ],
    "guaranteed": "beschwerde"
   },
   {
    "id": "ma1",
    "sectionId": "ma",
    "moduleId": "ma",
    "part": "Teil 1",
    "title": "Über Erfahrungen sprechen",
    "layout": "speak",
    "instructions": "Wählen Sie <b>eines</b> der sieben Themen und berichten Sie zusammenhängend über Ihre eigenen Erfahrungen damit. Anschließend beantworten Sie Rückfragen. Sprechzeit etwa <b>drei Minuten</b>.",
    "plain": "Sieben Themen stehen zur Wahl. Nehmen Sie eines und erzählen Sie von Ihrer eigenen Erfahrung damit. Etwa 3 Minuten sprechen.",
    "points": 25,
    "prepSeconds": 180,
    "recordSeconds": 180,
    "speakingKind": "bericht",
    "themes": [
     {
      "title": "Ein Buch",
      "short": "Buch",
      "task": "Berichten Sie über ein <b>Buch</b>, das Sie gelesen haben und das Ihnen etwas bedeutet. Sprechen Sie etwa drei Minuten zusammenhängend. Beantworten Sie anschließend die Nachfragen der Prüfenden.",
      "card": [
       "Welches Buch es ist und wie Sie darauf gekommen sind",
       "Worum es geht, in wenigen Sätzen, ohne den Schluss zu verraten",
       "Eine Stelle oder eine Person, die Ihnen besonders geblieben ist",
       "Was Ihnen daran gefallen hat und was nicht",
       "Wem Sie das Buch empfehlen würden und warum"
      ],
      "phrases": [
       "Ich habe mich für … entschieden, weil …",
       "Darauf gekommen bin ich durch …",
       "Ganz kurz zum Inhalt: …",
       "Besonders im Gedächtnis geblieben ist mir …",
       "Weniger überzeugt hat mich dagegen …",
       "Empfehlen würde ich es vor allem denen, die …"
      ],
      "keywords": [
       [
        "buch",
        "roman",
        "gelesen",
        "autor",
        "autorin",
        "titel",
        "geschichte"
       ],
       [
        "handelt von",
        "worum es geht",
        "inhalt",
        "erzählt",
        "spielt in",
        "hauptfigur"
       ],
       [
        "stelle",
        "kapitel",
        "figur",
        "person",
        "szene",
        "geblieben",
        "erinnere"
       ],
       [
        "gefallen",
        "gut gefallen",
        "schwach",
        "langweilig",
        "überzeugt",
        "kritik",
        "störend"
       ],
       [
        "empfehlen",
        "weiterempfehlen",
        "wer gern",
        "lohnt sich",
        "raten"
       ]
      ]
     },
     {
      "title": "Ein Film",
      "short": "Film",
      "task": "Berichten Sie über einen <b>Film</b>, den Sie gesehen haben und der Sie beschäftigt hat. Sprechen Sie etwa drei Minuten zusammenhängend. Beantworten Sie anschließend die Nachfragen der Prüfenden.",
      "card": [
       "Welcher Film es ist und wo Sie ihn gesehen haben",
       "Worum es geht, in wenigen Sätzen",
       "Eine Szene, die Ihnen im Gedächtnis geblieben ist",
       "Was der Film gut macht und wo er Sie nicht überzeugt hat",
       "Ob Sie ihn ein zweites Mal sehen würden und warum"
      ],
      "phrases": [
       "Gesehen habe ich ihn im Kino / zu Hause / mit …",
       "Der Film handelt von …",
       "Eine Szene ist mir besonders im Gedächtnis geblieben: …",
       "Was mich überzeugt hat, war vor allem …",
       "Gestört hat mich allerdings …",
       "Ein zweites Mal würde ich ihn sehen, weil …"
      ],
      "keywords": [
       [
        "film",
        "kino",
        "gesehen",
        "regisseur",
        "schauspieler",
        "serie",
        "streaming"
       ],
       [
        "handelt von",
        "geht um",
        "inhalt",
        "erzählt",
        "spielt",
        "hauptrolle"
       ],
       [
        "szene",
        "stelle",
        "moment",
        "bild",
        "musik",
        "ende",
        "anfang"
       ],
       [
        "überzeugt",
        "gefallen",
        "gestört",
        "schwach",
        "stark",
        "kritik",
        "langatmig"
       ],
       [
        "noch einmal",
        "zweites mal",
        "wiedersehen",
        "empfehlen",
        "lohnt"
       ]
      ]
     },
     {
      "title": "Ein wichtiger Mensch in Ihrem Leben",
      "short": "Wichtiger Mensch",
      "task": "Berichten Sie über einen <b>Menschen, der für Sie wichtig ist oder war</b>. Sprechen Sie etwa drei Minuten zusammenhängend. Beantworten Sie anschließend die Nachfragen der Prüfenden.",
      "card": [
       "Wer diese Person ist und woher Sie sie kennen",
       "Seit wann und in welcher Zeit Ihres Lebens sie eine Rolle spielt",
       "Eine Begebenheit, an der man erkennt, was sie Ihnen bedeutet",
       "Was Sie von ihr gelernt oder übernommen haben",
       "Wie der Kontakt heute ist"
      ],
      "phrases": [
       "Ich möchte über … sprechen.",
       "Kennengelernt habe ich sie / ihn, als …",
       "Eine Begebenheit zeigt das gut: …",
       "Von ihr / ihm gelernt habe ich vor allem …",
       "Bis heute ist es so, dass …",
       "Rückblickend würde ich sagen, dass …"
      ],
      "keywords": [
       [
        "mensch",
        "person",
        "freundin",
        "freund",
        "lehrerin",
        "lehrer",
        "großmutter",
        "großvater",
        "kollege",
        "kollegin",
        "nachbar"
       ],
       [
        "seit",
        "damals",
        "als ich",
        "kennengelernt",
        "begegnet",
        "jahre"
       ],
       [
        "einmal",
        "eines tages",
        "situation",
        "erlebnis",
        "geholfen",
        "erinnere"
       ],
       [
        "gelernt",
        "beigebracht",
        "vorbild",
        "übernommen",
        "geprägt",
        "verdanke"
       ],
       [
        "heute",
        "kontakt",
        "noch immer",
        "telefonieren",
        "sehen uns",
        "verloren"
       ]
      ]
     },
     {
      "title": "Ein wichtiges Erlebnis in Ihrem Leben",
      "short": "Wichtiges Erlebnis",
      "task": "Berichten Sie über ein <b>Erlebnis, das für Sie wichtig war</b>. Sprechen Sie etwa drei Minuten zusammenhängend. Beantworten Sie anschließend die Nachfragen der Prüfenden.",
      "card": [
       "Was passiert ist, wann und wo",
       "Wie es dazu kam",
       "Wie Sie sich dabei gefühlt haben",
       "Was sich danach für Sie geändert hat",
       "Wie Sie heute darauf zurückblicken"
      ],
      "phrases": [
       "Das Erlebnis liegt … zurück.",
       "Dazu gekommen ist es, weil …",
       "In dem Moment war ich …",
       "Danach hat sich vor allem geändert, dass …",
       "Heute sehe ich das etwas anders: …",
       "Rückblickend war es für mich …"
      ],
      "keywords": [
       [
        "erlebnis",
        "passiert",
        "ereignis",
        "tag",
        "damals",
        "jahr",
        "erinnere"
       ],
       [
        "dazu gekommen",
        "angefangen",
        "auslöser",
        "grund",
        "vorher",
        "plötzlich"
       ],
       [
        "gefühlt",
        "aufgeregt",
        "froh",
        "erleichtert",
        "unsicher",
        "stolz",
        "angst"
       ],
       [
        "danach",
        "geändert",
        "seitdem",
        "entschieden",
        "neu",
        "folgen"
       ],
       [
        "heute",
        "rückblickend",
        "inzwischen",
        "würde ich",
        "gelernt"
       ]
      ]
     },
     {
      "title": "Eine Musikveranstaltung",
      "short": "Musikveranstaltung",
      "task": "Berichten Sie über eine <b>Musikveranstaltung</b>, die Sie besucht haben: ein Konzert, ein Festival oder eine Aufführung. Sprechen Sie etwa drei Minuten zusammenhängend. Beantworten Sie anschließend die Nachfragen der Prüfenden.",
      "card": [
       "Um welche Veranstaltung es ging, wann und wo",
       "Mit wem Sie dort waren und wie Sie hingekommen sind",
       "Wie es dort war: Publikum, Stimmung, Ablauf",
       "Was Ihnen besonders gefallen hat und was weniger",
       "Ob Sie so etwas wieder besuchen würden"
      ],
      "phrases": [
       "Es war ein Konzert von … in …",
       "Hingegangen bin ich mit …",
       "Die Stimmung war …",
       "Am besten gefallen hat mir …",
       "Weniger schön war …",
       "Wieder hingehen würde ich, weil …"
      ],
      "keywords": [
       [
        "konzert",
        "festival",
        "aufführung",
        "band",
        "orchester",
        "musik",
        "bühne",
        "halle"
       ],
       [
        "mit",
        "zusammen",
        "karten",
        "tickets",
        "gefahren",
        "angereist",
        "abend"
       ],
       [
        "publikum",
        "stimmung",
        "voll",
        "laut",
        "applaus",
        "ablauf",
        "dauerte"
       ],
       [
        "gefallen",
        "besonders",
        "höhepunkt",
        "enttäuscht",
        "teuer",
        "schade"
       ],
       [
        "wieder",
        "noch einmal",
        "empfehlen",
        "nächstes mal",
        "lohnt"
       ]
      ]
     },
     {
      "title": "Eine Sportveranstaltung",
      "short": "Sportveranstaltung",
      "task": "Berichten Sie über eine <b>Sportveranstaltung</b>, bei der Sie dabei waren, als Zuschauerin oder Zuschauer oder selbst als Teilnehmerin oder Teilnehmer. Sprechen Sie etwa drei Minuten zusammenhängend. Beantworten Sie anschließend die Nachfragen der Prüfenden.",
      "card": [
       "Um welche Veranstaltung es ging, wann und wo",
       "Ob Sie zugeschaut oder selbst mitgemacht haben",
       "Wie der Tag ablief",
       "Ein Moment, der Ihnen geblieben ist",
       "Welche Rolle Sport sonst in Ihrem Alltag spielt"
      ],
      "phrases": [
       "Es ging um … im Jahr …",
       "Ich war als Zuschauerin / Zuschauer dabei bzw. ich bin selbst mitgelaufen.",
       "Der Tag lief so ab: …",
       "Geblieben ist mir vor allem der Moment, als …",
       "In meinem Alltag spielt Sport …",
       "Insgesamt war es für mich …"
      ],
      "keywords": [
       [
        "spiel",
        "turnier",
        "lauf",
        "marathon",
        "stadion",
        "mannschaft",
        "wettkampf",
        "sport"
       ],
       [
        "zugeschaut",
        "zuschauer",
        "mitgemacht",
        "teilgenommen",
        "gestartet",
        "angefeuert"
       ],
       [
        "ablauf",
        "morgens",
        "danach",
        "halbzeit",
        "ende",
        "ergebnis",
        "gewonnen",
        "verloren"
       ],
       [
        "moment",
        "augenblick",
        "tor",
        "ziel",
        "jubel",
        "spannend",
        "erinnere"
       ],
       [
        "alltag",
        "trainiere",
        "regelmäßig",
        "verein",
        "fitness",
        "selten",
        "kaum"
       ]
      ]
     },
     {
      "title": "Eine Reise",
      "short": "Reise",
      "task": "Berichten Sie über eine <b>Reise</b>, die Sie gemacht haben. Sprechen Sie etwa drei Minuten zusammenhängend. Beantworten Sie anschließend die Nachfragen der Prüfenden.",
      "card": [
       "Wohin die Reise ging, wann und mit wem",
       "Warum gerade dorthin",
       "Wie Sie gereist sind und wo Sie gewohnt haben",
       "Was Sie dort erlebt haben, mit einem Beispiel",
       "Was Sie beim nächsten Mal anders machen würden"
      ],
      "phrases": [
       "Die Reise ging nach … im …",
       "Gerade dorthin, weil …",
       "Gereist bin ich mit … und gewohnt habe ich …",
       "Ein Erlebnis ist mir besonders geblieben: …",
       "Nicht so gut war …",
       "Beim nächsten Mal würde ich …"
      ],
      "keywords": [
       [
        "reise",
        "gereist",
        "gefahren",
        "geflogen",
        "urlaub",
        "besucht",
        "land",
        "stadt"
       ],
       [
        "weil",
        "grund",
        "schon immer",
        "empfohlen",
        "interessiert",
        "wollte"
       ],
       [
        "zug",
        "flugzeug",
        "auto",
        "bus",
        "hotel",
        "wohnung",
        "gewohnt",
        "unterkunft"
       ],
       [
        "erlebt",
        "besichtigt",
        "gesehen",
        "essen",
        "menschen",
        "beispiel",
        "tag"
       ],
       [
        "nächstes mal",
        "anders",
        "länger",
        "kürzer",
        "würde ich",
        "planen"
       ]
      ]
     }
    ]
   },
   {
    "id": "ma2",
    "sectionId": "ma",
    "moduleId": "ma",
    "part": "Teil 2",
    "title": "Diskussion",
    "layout": "speak",
    "instructions": "Sie diskutieren mit Ihrer Partnerin oder Ihrem Partner über eine Frage: Standpunkt vertreten, auf Gegenargumente eingehen, überzeugen. Sprechzeit etwa <b>drei Minuten</b>.",
    "plain": "Sagen Sie Ihre Meinung und begründen Sie sie. Gehen Sie auch auf die Gegenmeinung ein. Etwa 3 Minuten sprechen.",
    "points": 25,
    "prepSeconds": 180,
    "recordSeconds": 180,
    "speakingKind": "diskussion"
   },
   {
    "id": "ma3",
    "sectionId": "ma",
    "moduleId": "ma",
    "part": "Teil 3",
    "title": "Gemeinsam etwas planen",
    "layout": "speak",
    "instructions": "Sie planen gemeinsam eine Aufgabe: Vorschläge machen, abwägen, sich einigen. Sprechzeit etwa <b>drei Minuten</b>.",
    "plain": "Planen Sie etwas zusammen. Machen Sie Vorschläge, wägen Sie ab und entscheiden Sie am Ende. Etwa 3 Minuten sprechen.",
    "points": 25,
    "prepSeconds": 180,
    "recordSeconds": 180,
    "speakingKind": "planung"
   }
  ],
  "scoring": {
   "total": 300,
   "pass": 180,
   "modules": [
    {
     "id": "lv",
     "name": "Leseverstehen",
     "max": 75,
     "source": "auto"
    },
    {
     "id": "sb",
     "name": "Sprachbausteine",
     "max": 30,
     "source": "auto"
    },
    {
     "id": "hv",
     "name": "Hörverstehen",
     "max": 75,
     "source": "auto"
    },
    {
     "id": "sa",
     "name": "Schriftlicher Ausdruck",
     "max": 45,
     "source": "marked"
    },
    {
     "id": "ma",
     "name": "Mündlicher Ausdruck",
     "max": 75,
     "source": "marked"
    }
   ],
   "groups": [
    {
     "name": "Schriftliche Prüfung gesamt",
     "moduleIds": [
      "lv",
      "sb",
      "hv",
      "sa"
     ],
     "max": 225,
     "min": 135
    },
    {
     "name": "Mündliche Prüfung",
     "moduleIds": [
      "ma"
     ],
     "max": 75,
     "min": 45
    }
   ]
  }
 }
} as const;

export default TELC_CONTENT;
