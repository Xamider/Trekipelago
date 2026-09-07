/** One foreground epoch prevents async work queued before screen lock from spawning afterward. */
export class ForegroundClock {
  private generation = 0;
  private visible = false;

  setVisible(visible: boolean) {
    this.visible = visible;
    this.generation++;
    return this.generation;
  }

  capture() { return this.generation; }
  permits(generation: number) { return this.visible && generation === this.generation; }
}
