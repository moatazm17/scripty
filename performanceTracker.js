class PerformanceTracker {
  constructor() {
    this.stages = [];
    this.startTime = Date.now();
    this.currentStage = null;
  }

  startStage(name) {
    // End previous stage if exists
    if (this.currentStage) {
      this.endStage();
    }
    
    this.currentStage = {
      name,
      start: Date.now()
    };
  }

  endStage() {
    if (this.currentStage) {
      this.currentStage.end = Date.now();
      this.currentStage.duration = this.currentStage.end - this.currentStage.start;
      this.stages.push(this.currentStage);
      this.currentStage = null;
    }
  }

  skip(name) {
    // End current stage if exists before skipping
    if (this.currentStage) {
      this.endStage();
    }
    
    this.stages.push({
      name,
      duration: 0,
      skipped: true
    });
  }
  
  /// Ensure all stages are closed (call before generating report)
  closeAll() {
    if (this.currentStage) {
      this.endStage();
    }
  }

  getReport() {
    const total = Date.now() - this.startTime;
    const slowest = this.stages.reduce((max, s) => 
      (s.duration || 0) > (max.duration || 0) ? s : max, 
      { duration: 0, name: 'none' }
    );
    
    return {
      stages: this.stages.map(s => ({
        name: s.name,
        duration_ms: s.duration || 0,
        duration_s: ((s.duration || 0) / 1000).toFixed(2),
        skipped: s.skipped || false
      })),
      total_ms: total,
      total_s: (total / 1000).toFixed(2),
      slowest: slowest.name
    };
  }

  logReport() {
    const report = this.getReport();
    console.log('\n📊 Performance Report:');
    console.log('┌─────────────────────────────┬──────────┐');
    console.log('│ Stage                       │ Time     │');
    console.log('├─────────────────────────────┼──────────┤');
    report.stages.forEach(s => {
      const status = s.skipped ? '(skipped)' : `${s.duration_s}s`;
      const name = s.name.padEnd(27);
      console.log(`│ ${name} │ ${status.padStart(8)} │`);
    });
    console.log('├─────────────────────────────┼──────────┤');
    console.log(`│ TOTAL                       │ ${report.total_s.padStart(7)}s │`);
    console.log('└─────────────────────────────┴──────────┘');
    if (report.slowest !== 'none') {
      console.log(`🐢 Slowest: ${report.slowest}`);
    }
  }
}

module.exports = PerformanceTracker;
