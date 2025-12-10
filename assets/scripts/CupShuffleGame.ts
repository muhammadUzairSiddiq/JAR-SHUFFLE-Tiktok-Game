import { _decorator, Component, Node, tween, Vec3, Label, math, EventTouch, UITransform, EventMouse, Sprite, input, Input, Camera, view, Vec2, Color } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('CupShuffleGame')
export class CupShuffleGame extends Component {

    @property([Node])
    cups: Node[] = []; // Jars (renamed from cups but keeping variable name for compatibility)

    @property([Node])
    hands: Node[] = []; // Hand nodes for animation (typically 2 hands)

    @property(Node)
    ball: Node = null!;

    @property(Label)
    resultLabel: Label = null!;

    @property
    swapsPerRound: number = 10;

    @property
    swapSpeed: number = 0.35; // Speed controller - higher value = slower shuffle

    @property
    handGrabOffset: Vec3 = new Vec3(0, 50, 0); // Offset when hand grabs a jar (higher Y = hands above jars)

    @property
    idleAnimationAmplitude: number = 3; // How much hands move during idle (very subtle)
    
    @property
    idleAnimationSpeed: number = 1.5; // Speed of idle animation

    @property
    jarLiftHeight: number = 80; // How high the jar is lifted during reveal

    @property
    jarTiltAngle: number = 15; // Z-axis tilt (degrees) during lift

    @property([Node])
    liftExtras: Node[] = []; // Nodes that should only be active during lift/reveal

    @property
    ballRevealDuration: number = 0.6; // How long the ball stays visible after reveal

    @property
    ballYPosition: number = -90; // Fixed Y-axis position for the ball

    @property(Color)
    highlightColor: Color = new Color(255, 105, 180, 160); // Tint for clicked jar

    private ballIndex: number = 1;
    private ballCup: Node | null = null; // Track which cup node has the ball
    private isShuffling = false;
    private waitingForInput = false;
    private consecutiveWins = 0;
    private baseSwapsPerRound = 10;
    private baseSwapSpeed = 0.35;
    private idleTweens: any[] = []; // Store idle animation tweens
    private demoShown = false;
    private highlightedCup: Node | null = null;

    onLoad() {
        // Start button removed - game auto-starts
    }

    start() {
        // Store initial hand positions for reset
        for (let i = 0; i < this.hands.length; i++) {
            if (this.hands[i]) {
                (this.hands[i] as any).initialPosition = this.hands[i].position.clone();
            }
        }
        
        // Setup cup click listeners
        this.setupCupListeners();
        
        // Ensure result label starts empty and ball hidden
        if (this.resultLabel) {
            this.resultLabel.string = '';
        }
        if (this.ball) {
            this.ball.active = false;
        }
        this.setLiftExtrasActive(false);
        
        // Save initial values from editor - these are the defaults that will be restored on wrong answer
        this.baseSwapsPerRound = this.swapsPerRound;
        this.baseSwapSpeed = this.swapSpeed;
        
        // Check if cups are assigned
        if (!this.cups.length) {
            if (this.resultLabel) {
                this.resultLabel.string = 'ERROR: Assign cups in editor!';
            }
            console.error('CupShuffleGame: Cups array is empty! Please assign cups in Cocos Creator editor.');
            return;
        } else {
            console.log('CupShuffleGame: Initialized with', this.cups.length, 'cups');
        }
        
        // Auto-start immediately
        // Start idle animations for hands
        this.startIdleAnimations();
        
        // Add global input handlers as fallback
        input.on(Input.EventType.TOUCH_END, this.onGlobalTouch, this);
        input.on(Input.EventType.MOUSE_UP, this.onGlobalMouse, this);
        
        // Start game after a brief delay
        this.scheduleOnce(() => {
            console.log('Auto-starting game...');
            this.onStart(true); // first round acts as demo
        }, 0.5);
    }
    
    onDestroy() {
        // Clean up global input handlers
        input.off(Input.EventType.TOUCH_END, this.onGlobalTouch, this);
        input.off(Input.EventType.MOUSE_UP, this.onGlobalMouse, this);
    }
    
    private onGlobalTouch(event: EventTouch) {
        const location = event.getLocation();
        console.log(`Global TOUCH_END at: ${location.x}, ${location.y}, waitingForInput: ${this.waitingForInput}, isShuffling: ${this.isShuffling}`);
        
        if (!this.waitingForInput || this.isShuffling) {
            console.log('Global touch ignored - not ready');
            return;
        }
        
        this.checkGlobalClick(location);
    }
    
    private onGlobalMouse(event: EventMouse) {
        const location = event.getLocation();
        console.log(`Global MOUSE_UP at: ${location.x}, ${location.y}, waitingForInput: ${this.waitingForInput}, isShuffling: ${this.isShuffling}`);
        
        if (!this.waitingForInput || this.isShuffling) {
            console.log('Global mouse ignored - not ready');
            return;
        }
        
        this.checkGlobalClick(location);
    }
    
    private checkGlobalClick(screenPos: Vec2) {
        const camera = Camera.main || this.node.scene?.getComponentInChildren(Camera);
        if (!camera) {
            console.log('No camera found for global click');
            return;
        }
        
        // Get Canvas node (cups are children of Canvas)
        const canvasNode = this.node.scene?.getComponentInChildren('cc.Canvas')?.node;
        if (!canvasNode) {
            console.log('No Canvas found');
            return;
        }
        
        // Convert screen to world using camera
        const screenVec3 = new Vec3(screenPos.x, screenPos.y, -camera.node.worldPosition.z);
        const worldPos = new Vec3();
        camera.screenToWorld(worldPos, screenVec3);
        
        // If that doesn't work, try manual conversion with Canvas position
        const screenSize = view.getVisibleSize();
        if (Math.abs(worldPos.x) < 1 && Math.abs(worldPos.y) < 1) {
            const orthoHeight = camera.orthoHeight || 320;
            const aspect = screenSize.width / screenSize.height;
            const orthoWidth = orthoHeight * aspect;
            const canvasPos = canvasNode.worldPosition;
            
            // Convert screen to Canvas local space
            const normalizedX = (screenPos.x / screenSize.width - 0.5) * 2;
            const normalizedY = ((screenSize.height - screenPos.y) / screenSize.height - 0.5) * 2;
            
            // World position relative to Canvas
            worldPos.x = canvasPos.x + normalizedX * (orthoWidth / 2);
            worldPos.y = canvasPos.y + normalizedY * (orthoHeight / 2);
            worldPos.z = 0;
        }
        
        console.log(`Screen: (${screenPos.x}, ${screenPos.y}) -> World: (${worldPos.x.toFixed(1)}, ${worldPos.y.toFixed(1)})`);
        
        // Check each cup using world-space bounds
        for (let i = 0; i < this.cups.length; i++) {
            const cup = this.cups[i];
            if (!cup || !cup.active) continue;
            
            const uiTransform = cup.getComponent(UITransform);
            if (!uiTransform) continue;
            
            // Get cup's world position and calculate bounds
            const cupWorldPos = cup.worldPosition;
            const cupSize = uiTransform.contentSize;
            const cupScale = cup.worldScale;
            const anchor = uiTransform.anchorPoint;
            
            // Calculate world-space bounds
            const width = cupSize.width * cupScale.x;
            const height = cupSize.height * cupScale.y;
            const left = cupWorldPos.x - width * anchor.x;
            const right = cupWorldPos.x + width * (1 - anchor.x);
            const bottom = cupWorldPos.y - height * anchor.y;
            const top = cupWorldPos.y + height * (1 - anchor.y);
            
            const inBoundsX = worldPos.x >= left && worldPos.x <= right;
            const inBoundsY = worldPos.y >= bottom && worldPos.y <= top;
            
            console.log(`Cup ${i}: pos(${cupWorldPos.x.toFixed(1)}, ${cupWorldPos.y.toFixed(1)}), bounds(${left.toFixed(1)}, ${right.toFixed(1)}, ${bottom.toFixed(1)}, ${top.toFixed(1)})`);
            console.log(`  Click(${worldPos.x.toFixed(1)}, ${worldPos.y.toFixed(1)}) in? X:${inBoundsX} Y:${inBoundsY}`);
            
            if (inBoundsX && inBoundsY) {
                console.log(`✓ Click detected on cup ${i}!`);
                this.onCupClicked(i, null);
                return;
            }
        }
        console.log('✗ Click not on any cup');
    }

    private setupCupListeners() {
        for (let i = 0; i < this.cups.length; i++) {
            const cup = this.cups[i];
            if (!cup) continue;
            
            // Ensure cup node is active
            cup.active = true;
            
            // Get or ensure UITransform exists on the cup node
            let uiTransform = cup.getComponent(UITransform);
            
            if (!uiTransform) {
                uiTransform = cup.addComponent(UITransform);
            }
            
            // Try to get proper size from Sprite component
            if (uiTransform) {
                const sprite = cup.getComponent(Sprite);
                if (sprite && sprite.spriteFrame) {
                    const rect = sprite.spriteFrame.rect;
                    // Only update if size is significantly different (to avoid overwriting correct sizes)
                    const currentSize = uiTransform.contentSize;
                    if (Math.abs(currentSize.width - rect.width) > 10 || 
                        Math.abs(currentSize.height - rect.height) > 10) {
                        uiTransform.setContentSize(rect.width, rect.height);
                        console.log(`Cup ${i}: Updated UITransform size to ${rect.width}x${rect.height}`);
                    }
                }
            }
            
            // Store cup index for reference
            (cup as any).cupIndex = i;
            
            // Remove any existing listeners first to prevent duplicates
            cup.off(Node.EventType.TOUCH_START);
            cup.off(Node.EventType.TOUCH_END);
            cup.off(Node.EventType.TOUCH_MOVE);
            cup.off(Node.EventType.MOUSE_DOWN);
            cup.off(Node.EventType.MOUSE_UP);
            
            // Create click handler
            const cupIndex = i; // Capture for closure
            const handleClick = (event: EventTouch | EventMouse) => {
                console.log(`Cup ${cupIndex} event received! waitingForInput: ${this.waitingForInput}, isShuffling: ${this.isShuffling}`);
                
                // Only process if waiting for input and not shuffling
                if (!this.waitingForInput || this.isShuffling) {
                    console.log(`Cup ${cupIndex} click ignored - not ready for input`);
                    return;
                }
                
                // Stop event propagation to prevent background clicks
                if (event instanceof EventTouch) {
                    event.propagationStopped = true;
                } else if (event instanceof EventMouse) {
                    event.propagationStopped = true;
                }
                
                console.log(`Cup ${cupIndex} clicked! Processing...`);
                this.onCupClicked(cupIndex, event instanceof EventTouch ? event : null);
            };
            
            // Add both touch and mouse events
            cup.on(Node.EventType.TOUCH_END, handleClick, this);
            cup.on(Node.EventType.MOUSE_UP, handleClick, this);
            
            // Also add to children if they exist (sprites might be in children)
            for (let j = 0; j < cup.children.length; j++) {
                const child = cup.children[j];
                child.off(Node.EventType.TOUCH_END);
                child.off(Node.EventType.MOUSE_UP);
                child.on(Node.EventType.TOUCH_END, handleClick, this);
                child.on(Node.EventType.MOUSE_UP, handleClick, this);
            }
            
            const finalSize = uiTransform ? `${uiTransform.contentSize.width}x${uiTransform.contentSize.height}` : 'none';
            console.log(`Cup ${i} listener setup complete. UITransform size: ${finalSize}, Active: ${cup.active}`);
        }
    }

    onStart(isDemoRound: boolean = false) {
        console.log('onStart called!', 'isShuffling:', this.isShuffling, 'waitingForInput:', this.waitingForInput, 'cups:', this.cups.length);
        
        if (this.isShuffling || this.waitingForInput) {
            console.log('Cannot start - already shuffling or waiting for input');
            return;
        }
        if (!this.cups.length) {
            if (this.resultLabel) {
                this.resultLabel.string = 'ERROR: No cups assigned!';
            }
            console.error('CupShuffleGame: Cannot start - cups array is empty!');
            return;
        }
        
        console.log('Starting shuffle...');

        // Stop idle animations during shuffle
        this.stopIdleAnimations();

        this.isShuffling = true;
        this.waitingForInput = false;
        if (this.resultLabel) {
            this.resultLabel.string = '';
        }
        this.clearHighlights();
        this.setLiftExtrasActive(false);
        if (this.ball) {
            this.ball.active = false; // stay hidden during shuffle
        }

        // Random starting cup for ball
        this.ballIndex = math.randomRangeInt(0, this.cups.length);
        this.ballCup = this.cups[this.ballIndex];
        this.placeBallUnderCup(this.ballIndex);

        // Calculate difficulty based on consecutive wins
        this.updateDifficulty();

        // Immediately shuffle
        this.shuffleCups(this.swapsPerRound, () => {
            this.isShuffling = false;
            
            // Resume idle animations after shuffle
            this.startIdleAnimations();
            
            if (isDemoRound && !this.demoShown) {
                this.demoShown = true;
                this.waitingForInput = false;
                const winningIndex = this.ballIndex;
                // Auto-reveal using the same animation path as a user click, then start a real round
                this.liftJarAndReveal(
                    winningIndex,
                    winningIndex,
                    true,
                    () => { this.onStart(false); },
                    false,
                    false
                );
                return;
            }

            this.waitingForInput = true;
            
            if (this.resultLabel) {
                this.resultLabel.string = '';
            }
            console.log('Shuffling complete! Waiting for cup click. Ball is under cup index:', this.ballIndex);
        });
    }

    private onCupClicked(cupIndex: number, event: EventTouch | null) {
        console.log(`onCupClicked called! Cup: ${cupIndex}, waitingForInput: ${this.waitingForInput}, isShuffling: ${this.isShuffling}`);
        
        if (!this.waitingForInput) {
            console.log('Ignoring click - not waiting for input');
            return;
        }
        if (this.isShuffling) {
            console.log('Ignoring click - still shuffling');
            return;
        }
        if (cupIndex < 0 || cupIndex >= this.cups.length) {
            console.log('Invalid cup index:', cupIndex);
            return;
        }
        
        // Disable all cups temporarily to prevent double clicks
        this.waitingForInput = false;
        this.highlightCup(this.cups[cupIndex]);
        
        console.log(`Processing click on cup ${cupIndex}`);
        this.checkAnswer(cupIndex);
    }

    private checkAnswer(clickedIndex: number) {
        this.waitingForInput = false;
        
        // Find which cup node has the ball (the winning cup)
        let winningCupIndex = -1;
        if (this.ballCup) {
            for (let i = 0; i < this.cups.length; i++) {
                if (this.cups[i] === this.ballCup) {
                    winningCupIndex = i;
                    break;
                }
            }
        }
        
        // Fallback to ballIndex if ballCup not found
        if (winningCupIndex === -1) {
            winningCupIndex = this.ballIndex;
        }
        
        // Check if user clicked the correct cup
        const isCorrect = (clickedIndex === winningCupIndex);
        
        // Immediately reset speed to initial if wrong answer
        if (!isCorrect) {
            this.consecutiveWins = 0;
            this.resetDifficulty();
        }
        
        // Animate jar lifting and reveal
        this.liftJarAndReveal(clickedIndex, winningCupIndex, isCorrect);
    }
    
    private liftJarAndReveal(
        clickedIndex: number,
        winningCupIndex: number,
        isCorrect: boolean,
        onComplete?: () => void,
        shouldRestartOnComplete: boolean = true,
        revealCorrectOnMiss: boolean = true
    ) {
        const clickedCup = this.cups[clickedIndex];
        if (!clickedCup) return;
        
        // Stop idle animations
        this.stopIdleAnimations();
        this.setLiftExtrasActive(true);
        
        // Get cup position and calculate positions
        const cupPos = clickedCup.position.clone();
        
        // Get jar top position for hand placement
        const getJarTopY = (jar: Node) => {
            const uiTransform = jar.getComponent(UITransform);
            if (uiTransform) {
                const size = uiTransform.contentSize;
                const anchor = uiTransform.anchorPoint;
                const scale = jar.worldScale;
                return jar.position.y + (size.height * (1 - anchor.y) * scale.y);
            }
            return jar.position.y + 50;
        };
        
        const jarTopY = getJarTopY(clickedCup);
        const minHeightAboveJar = 10;
        
        // Calculate hand position - single hand moves to the clicked jar
        const handGrabPos = new Vec3(
            cupPos.x,
            Math.max(jarTopY + minHeightAboveJar, cupPos.y + this.handGrabOffset.y),
            cupPos.z
        );
        
        // Calculate lifted jar position (jar moves up)
        const liftHeight = this.jarLiftHeight;
        const liftedCupPos = new Vec3(cupPos.x, cupPos.y + liftHeight, cupPos.z);

        // Capture initial rotation for restore and compute tilt target
        const initialEuler = clickedCup.eulerAngles.clone();
        const tiltedEuler = new Vec3(initialEuler.x, initialEuler.y, initialEuler.z + this.jarTiltAngle);
        
        // Select which hand to use based on jar position
        let hand: Node | null = null;
        let handIndex = 0;
        
        if (this.hands.length >= 2) {
            // Get positions of all jars to determine left/right/center
            const jarPositions: number[] = [];
            for (let i = 0; i < this.cups.length; i++) {
                if (this.cups[i]) {
                    jarPositions.push(this.cups[i].position.x);
                }
            }
            jarPositions.sort((a, b) => a - b); // Sort from left to right
            
            // Determine if clicked jar is left, center, or right
            const clickedJarX = cupPos.x;
            const isLeftJar = clickedJarX === jarPositions[0];
            const isRightJar = clickedJarX === jarPositions[jarPositions.length - 1];
            const isCenterJar = !isLeftJar && !isRightJar;
            
            // Get hand positions
            const leftHand = this.hands[0];
            const rightHand = this.hands[1];
            const leftHandX = leftHand ? leftHand.position.x : 0;
            const rightHandX = rightHand ? rightHand.position.x : 0;
            
            if (isCenterJar) {
                // Randomly choose hand for center jar
                handIndex = math.randomRangeInt(0, 2);
                hand = handIndex === 0 ? leftHand : rightHand;
                console.log(`Center jar clicked - randomly using ${handIndex === 0 ? 'left' : 'right'} hand`);
            } else {
                // Calculate distances to both hands
                const distToLeftHand = Math.abs(clickedJarX - leftHandX);
                const distToRightHand = Math.abs(clickedJarX - rightHandX);
                
                // Use the closer hand
                if (distToLeftHand < distToRightHand) {
                    hand = leftHand;
                    handIndex = 0;
                    console.log(`Using left hand (closer to jar at x: ${clickedJarX})`);
                } else {
                    hand = rightHand;
                    handIndex = 1;
                    console.log(`Using right hand (closer to jar at x: ${clickedJarX})`);
                }
            }
        } else if (this.hands.length === 1) {
            // Fallback: only one hand available
            hand = this.hands[0];
            handIndex = 0;
        }
        
        // Store initial hand position
        const handInitialPos = hand ? (hand as any).initialPosition || hand.position.clone() : null;
        
        // Animation timing - smoother and more realistic
        const grabTime = 0.35; // Time for hand to grab (slightly longer for smoothness)
        const liftTime = 0.5; // Time to lift jar (smoother)
        const revealTime = 0.6; // Time to show result
        const lowerTime = 0.4; // Time to lower jar back (smoother)
        
            // Phase 1: Hand moves to grab the jar (smoother animation)
            if (hand) {
            const tHandGrab = tween(hand)
                .to(grabTime, { position: handGrabPos }, { easing: 'cubicOut' });
            
            tHandGrab.start();
            
            // Phase 2: Lift the jar up (synchronized with hand, smoother)
            this.scheduleOnce(() => {
                const tCupLift = tween(clickedCup)
                    .to(liftTime, { position: liftedCupPos, eulerAngles: tiltedEuler }, { easing: 'cubicOut' });
                
                // Hand follows the jar up (smoother)
                const handLiftedPos = new Vec3(
                    handGrabPos.x,
                    handGrabPos.y + liftHeight,
                    handGrabPos.z
                );
                const tHandLift = tween(hand)
                    .to(liftTime, { position: handLiftedPos }, { easing: 'cubicOut' });
                
                tCupLift.start();
                tHandLift.start();
                
                // Phase 3: Reveal the ball immediately when jar is lifted (or show empty)
                this.scheduleOnce(() => {
                    if (isCorrect && this.ball && this.ballCup) {
                        // Show ball with fixed Y position
                        const ballPos = new Vec3(liftedCupPos.x, this.ballYPosition, liftedCupPos.z);
                        this.ball.setPosition(ballPos);
                        this.ball.active = true;
                        // Auto-hide after configured duration
                        this.scheduleOnce(() => {
                            if (this.ball) {
                                this.ball.active = false;
                            }
                        }, this.ballRevealDuration);
                    }
                    // If wrong, ball stays hidden (jar is empty) - don't show it at all
                    
                    // Track streak internally only; no on-screen text
                    if (isCorrect) {
                        this.consecutiveWins++;
                    }
                    
                    // Phase 4: Lower jar back down with wobble effect
                    this.scheduleOnce(() => {
                        // Lower jar smoothly
                        const tCupLower = tween(clickedCup)
                            .to(lowerTime, { position: cupPos, eulerAngles: initialEuler }, { easing: 'cubicIn' });
                        
                        // Hand returns to initial position (smoother)
                        if (hand && handInitialPos) {
                            const tHandReturn = tween(hand)
                                .to(lowerTime, { position: handInitialPos }, { easing: 'cubicIn' });
                            tHandReturn.start();
                        }
                        
                        tCupLower.start();
                        
                        // Add wobble/jitter effect when jar reaches original position
                        this.scheduleOnce(() => {
                            // Wobble effect - more noticeable random movements for realism
                            const wobbleAmount = 8; // How much to wobble (increased for visibility)
                            const wobbleDuration = 0.2; // Duration of each wobble (slightly longer)
                            const wobbleCount = 4; // Number of wobbles (more wobbles)
                            
                            let wobbleIndex = 0;
                            const performWobble = () => {
                                if (wobbleIndex >= wobbleCount) return;
                                
                                // Random offset for wobble (more noticeable)
                                const wobbleX = (Math.random() - 0.5) * wobbleAmount;
                                const wobbleY = (Math.random() - 0.5) * wobbleAmount * 0.6; // Slightly more vertical wobble
                                const wobblePos = new Vec3(
                                    cupPos.x + wobbleX,
                                    cupPos.y + wobbleY,
                                    cupPos.z
                                );
                                
                                // Quick wobble animation
                                const tWobble = tween(clickedCup)
                                    .to(wobbleDuration * 0.5, { position: wobblePos }, { easing: 'sineInOut' })
                                    .to(wobbleDuration * 0.5, { position: cupPos }, { easing: 'sineInOut' })
                                    .call(() => {
                                        wobbleIndex++;
                                        if (wobbleIndex < wobbleCount) {
                                            performWobble();
                                        }
                                    });
                                
                                tWobble.start();
                            };
                            
                            performWobble();
                            
                            // After wobble completes, finish round
                            this.scheduleOnce(() => {
                                // Keep ball visible under the correct jar when guessed right
                                if (isCorrect && this.ball) {
                                    this.placeBallUnderCup(clickedIndex);
                                    this.ball.active = true;
                                }

                                // If wrong and we need to reveal the correct jar, do that using the same animation path
                                if (!isCorrect && revealCorrectOnMiss) {
                                    this.liftJarAndReveal(
                                        winningCupIndex,
                                        winningCupIndex,
                                        true,
                                        onComplete,
                                        shouldRestartOnComplete,
                                        false
                                    );
                                    return;
                                }

                                // Hide ball before restarting to avoid overlap under lowered jars
                                if (this.ball) {
                                    this.ball.active = false;
                                }
                                this.setLiftExtrasActive(false);

        const finish = () => {
                                    if (onComplete) {
                                        onComplete();
                                        return;
                                    }
                                    if (!shouldRestartOnComplete) {
                                        return;
                                    }
                                    if (isCorrect) {
                                        this.scheduleOnce(() => {
                                            this.onStart(false);
                                        }, 0.5);
                                    } else {
                                        this.consecutiveWins = 0;
                                        this.resetDifficulty();
                                        this.scheduleOnce(() => {
                                            this.onStart(false);
                                        }, 1.0);
                                    }
                                };

                                finish();
                            }, wobbleDuration * wobbleCount + 0.1);
                        }, lowerTime);
                    }, revealTime);
                }, liftTime);
            }, grabTime);
        } else {
            // Fallback: no hand, just lift jar (with smoother animations)
            const tCupLift = tween(clickedCup)
                .to(liftTime, { position: liftedCupPos, eulerAngles: tiltedEuler }, { easing: 'cubicOut' });
            tCupLift.start();
            
            this.scheduleOnce(() => {
                // Reveal ball immediately when lifted (if correct)
                if (isCorrect && this.ball && this.ballCup) {
                    const ballPos = new Vec3(liftedCupPos.x, this.ballYPosition, liftedCupPos.z);
                    this.ball.setPosition(ballPos);
                    this.ball.active = true;
                    // Auto-hide after configured duration
                    this.scheduleOnce(() => {
                        if (this.ball) {
                            this.ball.active = false;
                        }
                    }, this.ballRevealDuration);
                }
                // If wrong, ball stays hidden
                
                if (isCorrect) {
                    this.consecutiveWins++;
                }
                
                this.scheduleOnce(() => {
                    const tCupLower = tween(clickedCup)
                        .to(lowerTime, { position: cupPos, eulerAngles: initialEuler }, { easing: 'cubicIn' });
                    tCupLower.start();
                    
                    // Add wobble effect when jar returns
                    this.scheduleOnce(() => {
                        const wobbleAmount = 8; // Increased for more visibility
                        const wobbleDuration = 0.2; // Slightly longer
                        const wobbleCount = 4; // More wobbles
                        
                        let wobbleIndex = 0;
                        const performWobble = () => {
                            if (wobbleIndex >= wobbleCount) return;
                            
                            const wobbleX = (Math.random() - 0.5) * wobbleAmount;
                            const wobbleY = (Math.random() - 0.5) * wobbleAmount * 0.6; // More vertical wobble
                            const wobblePos = new Vec3(
                                cupPos.x + wobbleX,
                                cupPos.y + wobbleY,
                                cupPos.z
                            );
                            
                            const tWobble = tween(clickedCup)
                                .to(wobbleDuration * 0.5, { position: wobblePos }, { easing: 'sineInOut' })
                                .to(wobbleDuration * 0.5, { position: cupPos }, { easing: 'sineInOut' })
                                .call(() => {
                                    wobbleIndex++;
                                    if (wobbleIndex < wobbleCount) {
                                        performWobble();
                                    }
                                });
                            
                            tWobble.start();
                        };
                        
                        performWobble();
                        
                        this.scheduleOnce(() => {
                            if (isCorrect && this.ball) {
                                this.placeBallUnderCup(clickedIndex);
                                this.ball.active = true;
                            }

                            if (!isCorrect && revealCorrectOnMiss) {
                                this.liftJarAndReveal(
                                    winningCupIndex,
                                    winningCupIndex,
                                    true,
                                    onComplete,
                                    shouldRestartOnComplete,
                                    false
                                );
                                return;
                            }
                            
                            // Hide ball before restarting to avoid overlap under lowered jars
                            if (this.ball) {
                                this.ball.active = false;
                            }
                            this.setLiftExtrasActive(false);
                            
                            const finish = () => {
                                if (onComplete) {
                                    onComplete();
                                    return;
                                }
                                if (!shouldRestartOnComplete) {
                                    return;
                                }
                                if (isCorrect) {
                                    this.scheduleOnce(() => {
                                        this.onStart(false);
                                    }, 0.5);
                                } else {
                                    // Speed already reset immediately when wrong answer detected
                                    this.scheduleOnce(() => {
                                        this.onStart(false);
                                    }, 1.0);
                                }
                            };

                            finish();
                        }, wobbleDuration * wobbleCount + 0.1);
                    }, lowerTime);
                }, revealTime);
            }, liftTime);
        }
    }

    private updateDifficulty() {
        // Increase difficulty based on consecutive wins
        // More wins = more swaps and faster speed (harder to track)
        // Only increases speed when consecutiveWins > 0 (correct answers in a row)
        const difficultyMultiplier = 1 + (this.consecutiveWins * 0.1);
        this.swapsPerRound = Math.floor(this.baseSwapsPerRound * difficultyMultiplier);
        
        // Speed increases (lower value = faster, but cap at minimum for smoothness)
        this.swapSpeed = Math.max(0.15, this.baseSwapSpeed / (1 + (this.consecutiveWins * 0.12)));
        
        // After 10 wins, make it very difficult
        if (this.consecutiveWins >= 10) {
            this.swapsPerRound = Math.floor(this.baseSwapsPerRound * 2.5);
            this.swapSpeed = Math.max(0.12, this.baseSwapSpeed / 2.5);
        }
        
        console.log('Difficulty updated: consecutiveWins =', this.consecutiveWins, 'swapSpeed =', this.swapSpeed, 'swapsPerRound =', this.swapsPerRound);
    }

    private resetDifficulty() {
        // Reset to initial values saved from editor
        this.swapsPerRound = this.baseSwapsPerRound;
        this.swapSpeed = this.baseSwapSpeed;
        console.log('Difficulty reset to initial: swapSpeed =', this.swapSpeed, 'swapsPerRound =', this.swapsPerRound);
    }

    private placeBallUnderCup(index: number) {
        if (!this.ball || !this.cups[index]) return;
        const cupPos = this.cups[index].position.clone();
        cupPos.y = this.ballYPosition;        // Fixed Y position (editable in inspector)
        this.ball.setPosition(cupPos);
    }


    private shuffleCups(times: number, done: () => void) {
        if (times <= 0) {
            // Reset hands to original positions when done
            this.resetHands();
            done();
            return;
        }

        let a = math.randomRangeInt(0, this.cups.length);
        let b = math.randomRangeInt(0, this.cups.length);
        while (b === a) {
            b = math.randomRangeInt(0, this.cups.length);
        }

        const jarA = this.cups[a];
        const jarB = this.cups[b];

        const posA = jarA.position.clone();
        const posB = jarB.position.clone();

        // Get hands for animation (use first 2 hands, or cycle through available hands)
        const hand1 = this.hands.length > 0 ? this.hands[0] : null;
        const hand2 = this.hands.length > 1 ? this.hands[1] : (this.hands.length > 0 ? this.hands[0] : null);

        // Calculate jar top positions (hands must stay at or above jar top)
        const getJarTopY = (jar: Node) => {
            const uiTransform = jar.getComponent(UITransform);
            if (uiTransform) {
                const size = uiTransform.contentSize;
                const anchor = uiTransform.anchorPoint;
                const scale = jar.worldScale;
                const jarTop = jar.position.y + (size.height * (1 - anchor.y) * scale.y);
                return jarTop;
            }
            // Fallback: assume jar is about 100 units tall
            return jar.position.y + 50;
        };

        const jarATopY = getJarTopY(jarA);
        const jarBTopY = getJarTopY(jarB);

        // Calculate hand positions - ensure they're always at or above jar top with minimum offset
        // Use the maximum of: jar top, jar position + offset, or jar top + minimum buffer
        const minHeightAboveJar = 10; // Minimum height above jar top
        const grabPosA = new Vec3(posA.x, Math.max(jarATopY + minHeightAboveJar, posA.y + this.handGrabOffset.y), posA.z);
        const grabPosB = new Vec3(posB.x, Math.max(jarBTopY + minHeightAboveJar, posB.y + this.handGrabOffset.y), posB.z);
        const releasePosA = new Vec3(posB.x, Math.max(jarBTopY + minHeightAboveJar, posB.y + this.handGrabOffset.y), posB.z);
        const releasePosB = new Vec3(posA.x, Math.max(jarATopY + minHeightAboveJar, posA.y + this.handGrabOffset.y), posA.z);

        // Animation timing - sequential and smooth with better proportions
        const grabTime = this.swapSpeed * 0.3; // Time to grab (slightly longer for smoothness)
        const moveTime = this.swapSpeed * 0.5; // Time to move (main movement)
        const releaseTime = this.swapSpeed * 0.2; // Time to release (quicker release)

        // Animate hands
        if (hand1 && hand2) {
            // Store initial hand positions (from idle or reset position)
            let hand1InitialPos = hand1.position.clone();
            let hand2InitialPos = hand2.position.clone();
            
            // Ensure initial positions are also above jar level with minimum buffer
            const minJarTop = Math.max(jarATopY, jarBTopY);
            const minHeightAboveJar = 10; // Minimum height above jar top
            hand1InitialPos.y = Math.max(hand1InitialPos.y, minJarTop + minHeightAboveJar);
            hand2InitialPos.y = Math.max(hand2InitialPos.y, minJarTop + minHeightAboveJar);
            
            // Animate jars moving (synchronized with hands) - smoother easing
            const tJarA = tween(jarA).to(moveTime, { position: posB }, { easing: 'sineInOut' });
            const tJarB = tween(jarB).to(moveTime, { position: posA }, { easing: 'sineInOut' });

            // Hand 1 sequence: grab -> move with jar -> release (smoother easing)
            const tHand1Grab = tween(hand1)
                .to(grabTime, { position: grabPosA }, { easing: 'sineOut' });
            
            const tHand1Move = tween(hand1)
                .to(moveTime, { position: releasePosA }, { easing: 'sineInOut' });
            
            const tHand1Release = tween(hand1)
                .to(releaseTime, { position: hand1InitialPos }, { easing: 'sineIn' });

            // Hand 2 sequence: grab -> move with jar -> release (smoother easing)
            const tHand2Grab = tween(hand2)
                .to(grabTime, { position: grabPosB }, { easing: 'sineOut' });
            
            const tHand2Move = tween(hand2)
                .to(moveTime, { position: releasePosB }, { easing: 'sineInOut' });
            
            const tHand2Release = tween(hand2)
                .to(releaseTime, { position: hand2InitialPos }, { easing: 'sineIn' });

            // Properly sequenced animation
            tween(this.node)
                .call(() => {
                    // Phase 1: Both hands grab simultaneously
                    tHand1Grab.start();
                    tHand2Grab.start();
                })
                .delay(grabTime)
                .call(() => {
                    // Phase 2: Move jars and hands together (synchronized)
                    tJarA.start();
                    tJarB.start();
                    tHand1Move.start();
                    tHand2Move.start();
                })
                .delay(moveTime)
                .call(() => {
                    // Phase 3: Both hands release simultaneously
                    tHand1Release.start();
                    tHand2Release.start();
                })
                .delay(releaseTime + 0.05)
                .call(() => {
                    // Swap jar positions in array
                    this.cups[a] = jarB;
                    this.cups[b] = jarA;

                    // Update ball tracking
                    if (this.ballCup === jarA) {
                        this.ballIndex = b;
                    } else if (this.ballCup === jarB) {
                        this.ballIndex = a;
                    }

                    this.shuffleCups(times - 1, done);
                })
                .start();
        } else {
            // Fallback: no hands, just move jars (with smooth animation)
            const tJarA = tween(jarA).to(this.swapSpeed, { position: posB }, { easing: 'sineInOut' });
            const tJarB = tween(jarB).to(this.swapSpeed, { position: posA }, { easing: 'sineInOut' });
            
            tween(this.node)
                .call(() => {
                    tJarA.start();
                    tJarB.start();
                })
                .delay(this.swapSpeed + 0.02)
                .call(() => {
                    // Swap jar positions in array
                    this.cups[a] = jarB;
                    this.cups[b] = jarA;

                    // Update ball tracking
                    if (this.ballCup === jarA) {
                        this.ballIndex = b;
                    } else if (this.ballCup === jarB) {
                        this.ballIndex = a;
                    }

                    this.shuffleCups(times - 1, done);
                })
                .start();
        }
    }

    private resetHands() {
        // Reset hands to their original positions (store initial positions in onLoad)
        if (this.hands.length > 0 && (this.hands[0] as any).initialPosition) {
            for (let i = 0; i < this.hands.length; i++) {
                if (this.hands[i] && (this.hands[i] as any).initialPosition) {
                    this.hands[i].setPosition((this.hands[i] as any).initialPosition);
                }
            }
        }
    }

    private highlightCup(cup: Node | null) {
        this.clearHighlights();
        if (!cup) return;
        const sprite = cup.getComponent(Sprite);
        if (sprite) {
            // Subtle tint controlled from the editor
            sprite.color = this.highlightColor;
            this.highlightedCup = cup;
        }
    }

    private clearHighlights() {
        if (this.highlightedCup) {
            const sprite = this.highlightedCup.getComponent(Sprite);
            if (sprite) {
                sprite.color = Color.WHITE;
            }
            this.highlightedCup = null;
        }
    }

    private setLiftExtrasActive(active: boolean) {
        for (let i = 0; i < this.liftExtras.length; i++) {
            if (this.liftExtras[i]) {
                this.liftExtras[i].active = active;
            }
        }
    }

    private startIdleAnimations() {
        // Stop any existing idle animations first
        this.stopIdleAnimations();
        
        // Create subtle idle movement for each hand
        for (let i = 0; i < this.hands.length; i++) {
            const hand = this.hands[i];
            if (!hand) continue;
            
            // Get initial position (stored in start() or use current position)
            const initialPos = (hand as any).initialPosition || hand.position.clone();
            if (!(hand as any).initialPosition) {
                (hand as any).initialPosition = initialPos.clone();
            }
            
            // Create a subtle floating/bobbing animation
            // Each hand moves slightly differently for natural variation
            const offsetX = (i % 2 === 0 ? 1 : -1) * this.idleAnimationAmplitude * 0.5;
            const offsetY = this.idleAnimationAmplitude;
            
            // Create a smooth, continuous idle animation
            const idleTween = tween(hand)
                .to(this.idleAnimationSpeed, 
                    { 
                        position: new Vec3(
                            initialPos.x + offsetX, 
                            initialPos.y + offsetY, 
                            initialPos.z
                        ) 
                    }, 
                    { easing: 'sineInOut' }
                )
                .to(this.idleAnimationSpeed, 
                    { 
                        position: new Vec3(
                            initialPos.x - offsetX, 
                            initialPos.y - offsetY, 
                            initialPos.z
                        ) 
                    }, 
                    { easing: 'sineInOut' }
                )
                .union()
                .repeatForever()
                .start();
            
            this.idleTweens.push(idleTween);
        }
    }

    private stopIdleAnimations() {
        // Stop all idle animation tweens
        for (let i = 0; i < this.idleTweens.length; i++) {
            if (this.idleTweens[i]) {
                this.idleTweens[i].stop();
            }
        }
        this.idleTweens = [];
        
        // Reset hands to initial positions
        this.resetHands();
    }
}
