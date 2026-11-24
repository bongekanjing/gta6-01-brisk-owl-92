// Keyboard and mouse, reduced to the handful of values the simulation wants: how far forward and
// right the player is pressing, whether they are sprinting, jumping, using or firing, and where the
// camera looks. Keys are tracked by `code` so the layout does not matter, and the camera yaw is
// owned here because both the player's facing and the mouse share it.
export const KEY_FORWARD = new Set(['KeyW', 'ArrowUp']);
export const KEY_BACK = new Set(['KeyS', 'ArrowDown']);
export const KEY_LEFT = new Set(['KeyA', 'ArrowLeft']);
export const KEY_RIGHT = new Set(['KeyD', 'ArrowRight']);

export function createInput(canvas) {
  const held = new Set();
  const input = {
    forward: 0,
    back: 0,
    left: 0,
    right: 0,
    sprint: false,
    jump: false,
    use: false,
    fire: false,
    brake: false,
    yaw: Math.PI,
    pitch: -0.06,
  };

  let jumpLatch = false;
  let useLatch = false;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    held.add(event.code);
    if (event.code === 'Space') {
      jumpLatch = true;
      event.preventDefault();
    }
    if (event.code === 'KeyE' || event.code === 'Enter') useLatch = true;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => held.delete(event.code));
  window.addEventListener('blur', () => held.clear());

  // Pointer lock is the normal way to look around; without it (or before a click) the arrow keys
  // still turn the camera, so the game is always playable.
  let locked = false;
  canvas.addEventListener('click', () => {
    if (!locked && canvas.requestPointerLock) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
  });
  window.addEventListener('mousemove', (event) => {
    if (!locked) return;
    input.yaw -= event.movementX * 0.0026;
    input.pitch = Math.max(-0.85, Math.min(0.6, input.pitch - event.movementY * 0.0022));
  });
  canvas.addEventListener('mousedown', (event) => {
    if (event.button === 0) input.fire = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) input.fire = false;
  });

  return {
    /** Sample the held keys into the values one simulation step reads. */
    read() {
      input.forward = held.has('KeyW') || held.has('ArrowUp') ? 1 : 0;
      input.back = held.has('KeyS') || held.has('ArrowDown') ? 1 : 0;
      input.left = held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0;
      input.right = held.has('KeyD') || held.has('ArrowRight') ? 1 : 0;
      input.sprint = held.has('ShiftLeft') || held.has('ShiftRight');
      input.brake = held.has('KeyQ');
      input.jump = jumpLatch;
      input.use = useLatch;
      jumpLatch = false;
      useLatch = false;
      return input;
    },
    /** Turn the camera with the arrow keys when the pointer is not locked. */
    turn(dt) {
      if (locked) return;
      if (held.has('ArrowLeft')) input.yaw += 2.2 * dt;
      if (held.has('ArrowRight')) input.yaw -= 2.2 * dt;
    },
  };
}
