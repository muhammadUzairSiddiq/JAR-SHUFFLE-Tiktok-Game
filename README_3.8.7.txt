Cup & Ball Shuffle - Cocos Creator 3.8.7 Skeleton
=================================================

This folder is structured as a Cocos Creator 3.x project and tagged for 3.8.7
via project.json. If the Dashboard still shows "Missing editor", simply bind
Cocos Creator 3.8.7 to the project or create a new 3.8.7 project and copy
the 'assets' folder over.

Included:
- project.json (engine/version hint: 3.8.7)
- package.json
- assets/scripts/CupShuffleGame.ts
- assets/textures/background.png
- assets/textures/table.png
- assets/textures/ball.png
- assets/textures/cup.png
- assets/scenes/ (empty; create Main.scene in Creator)

Usage with Cocos Creator 3.8.7
------------------------------

1. In Cocos Dashboard 3.8.7, click "Add" and select this folder:
   cup-shuffle-creator-3.8.7
2. If Dashboard still says "Missing editor", click the three dots (...) and
   bind version 3.8.7, OR:
   a. Create a brand new 3.8.7 2D project.
   b. Copy the 'assets' folder from this zip into that new project.
3. Inside Creator, create a new 2D scene (Main.scene) under assets/scenes and
   follow the wiring instructions: Canvas, cups, ball, GameRoot with
   CupShuffleGame script, button events, etc.

Once wired, press Play (or Preview in browser) to run the HTML5 game.
