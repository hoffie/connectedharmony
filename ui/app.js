function getNoteFrequency(halftonesFromA) {
  const halftoneMultiplier = Math.pow(2, 1/12);
  return 880 * Math.pow(halftoneMultiplier, halftonesFromA);
}

const Index = {
  template: '#index-template',
};
const Project = {
  template: '#project-template',
  data: function() {
    return {
      recording: false,
      recordingAborted: false,
      playing: false,
      uploading: false,
      uploaded: false,
      uploadError: false,
      videoSupport: false,
      mediaStream: null,
      mediaError: false,
      audioContext: null,
      recordedBlob: null,
      recordedVideoURL: '',
      referenceMediaElement: null,
      referenceSource: null,
      loadReferenceError: false,
      recordedMediaElement: null,
      delay: 0,
      startupDelay: 1, // time until metronome starts
      metronomeSources: [],
      delaySliderVisible: false,
      retryVisible: false,
      accuracyCheckVisible: false,
      step: 1,
      // loaded via json:
      project: {},
      // to be submitted at the end:
      voiceID: 0,
      participantName: '',
      useVideo: false,
      videoSupported: false,
    };
  },
  computed: {
    playbackSupported: function() {
      if (!this.audioContext) return false;
      return !!this.audioContext.decodeAudioData;
    },
    videoWidth: function() {
      switch (this.$vuetify.breakpoint.name) {
        case 'xs': return 120;
        case 'sm': return 200;
        default: return 500;
      };
    },
  },
  methods: {
    toggleRecord: function() {
      this.recording = !this.recording;
      if (this.recording) {
        this.startRecording();
      } else {
        this.abortRecording();
      }
    },
    onMedia: function(stream) {
      this.mediaStream = stream;
    },
    startRecording: function() {
      this.uploaded = false;
      this.delaySliderVisible = false;
      this.retryVisible = false;
      this.accuracyCheckVisible = false;
      this.recordingAborted = false;
      this.stopReference();
      this.stopRecorded();
      this.recordedBlob = null;
      this.recordedVideoURL = '';
      var type = this.videoSupported && this.useVideo ? 'video' : 'audio';
      this.recordRTC = RecordRTC(this.mediaStream, { type: type, });

      var startTime = this.audioContext.currentTime + this.startupDelay;
      this.recordRTC.startRecording(); // no way to schedule that start, so just start now
      this.startMetronome(startTime);
      var onended = function() {
        if (this.recordingAborted) {
          this.recording = false;
          this.recordRTC.stopRecording(function() {});
          return;
        }
        window.setTimeout(function() {
          this.recording = false;
          // wait some time before stopping recording because playback may
          // be delayed.
          this.recordRTC.stopRecording(function() {
            if (!this.recordingAborted) {
              this.recordedBlob = this.recordRTC.getBlob();
              this.step = 3;
            }
            if (this.project.WantVideo && this.videoSupported && this.useVideo) {
              this.recordedVideoURL = URL.createObjectURL(this.recordedBlob);
            }
          }.bind(this));
        }.bind(this), 2500);
      }.bind(this);
      this.playReference(startTime + this.getTimeToBeat(this.project.BeatsBeforeStart), 1, onended);
    },
    getTimeToBeat: function(beat) {
      return beat * 60/this.project.BeatsPerMinute;
    },
    startMetronome: function(startTime) {
      this.stopMetronome();
      var gain = this.audioContext.createGain();
      gain.gain.value = 0.2;
      gain.connect(this.audioContext.destination);
      this.metronomeSources.push(gain);
      const tickLength = 60/this.project.BeatsPerMinute/8;
      for (var beat = 0; beat < this.project.BeatsBeforeStart; beat++) {
        var src = this.audioContext.createOscillator();
        src.frequency.value = this.project.BeepFrequency;
        if ((beat % this.project.BeatsPerMeasure) != 0) {
          src.frequency.value = this.project.BeepFrequency/2;
        }
        src.connect(gain);
        var beatStartTime = startTime + this.getTimeToBeat(beat);
        src.start(beatStartTime);
        src.stop(beatStartTime + tickLength);
        this.metronomeSources.push(src);
      }
    },
    stopMetronome: function() {
      for (var i = 0; i < this.metronomeSources.length; i++) {
        this.metronomeSources[i].disconnect();
      }
      this.metronomeSources = [];
    },
    abortRecording: function() {
      this.recordingAborted = true;
      this.recordRTC.stopRecording(function() {
        this.recording = false;
      }.bind(this));
      this.stopMetronome();
      this.stopReference();
      this.recordedBlob = null;
    },
    playRecorded: async function() {
      var startTime = this.audioContext.currentTime + this.startupDelay;

      this.stopRecorded();
      this.recordedMediaElement = new Audio();
      this.recordedMediaElement.oncanplaythrough = function() {
        this.recordedMediaElement.oncanplaythrough = null;
        this.recordedMediaElement.currentTime += this.startupDelay + this.getTimeToBeat(this.project.BeatsBeforeStart)
        this.recordedMediaElement.addEventListener('ended', function() {
          console.log("recorded player ended");
          this.playing = false;
        }.bind(this));
        window.setTimeout(function() {
          if (this.playing) {
            this.recordedMediaElement.play();
          }
        }.bind(this), 1000*(startTime - this.audioContext.currentTime));
      }.bind(this);
      this.recordedSource = this.audioContext.createMediaElementSource(this.recordedMediaElement);
      this.recordedSource.connect(this.audioContext.destination);
      this.recordedMediaElement.src = URL.createObjectURL(this.recordedBlob);
      this.playReference(startTime + this.delay/1000, 0.1);
    },
    stopRecorded: function() {
      if (this.recordedMediaElement) {
        this.recordedMediaElement.pause();
        this.recordedSource.disconnect();
      }
      this.stopReference();
    },
    togglePlayRecorded: function() {
      this.playing = !this.playing;
      if (this.playing) {
        this.accuracyCheckVisible = true;
        this.playRecorded();
      } else {
        this.stopRecorded();
      }
    },
    upload: function() {
      this.uploading = true;
      this.uploadError = false;
      this.uploadMetadata();
    },
    uploadMetadata: function() {
      var metadata = {
        VoiceID: this.voiceID,
        ParticipantName: this.participantName,
        OffsetMsec: this.delay,
        HasVideo: this.useVideo,
      };
      fetch('/api/project/' + this.$route.params.project_key + '/recording', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
      })
      .then(async (d) => {
        if (d && d.status == 201 && d.ok) {
          var m = await d.json();
          this.uploadRecording(m);
          return;
        }
        this.uploadError = true;
        console.log("uploadMeta: Upload error (unsuccessful return code)", d);
        var e = new Error();
        sendErrorEvent({
          Source: 'app.js:uploadMetadata:fetch',
          Message: 'status',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: d,
        });
      })
      .catch((e) => {
        console.log('Upload error:', e);
        this.uploading = false;
        this.uploadError = true;
        sendErrorEvent({
          Source: 'app.js:uploadMetadata:fetch',
          Message: 'catch',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: e,
        });
      });
    },
    uploadRecording: function(m) {
      fetch('/api/project/' + this.$route.params.project_key + '/recording/' + m.RecordingID, {
        method: 'PUT',
        body: this.recordedBlob,
      })
      .then((d) => {
        this.uploading = false;
        if (d && d.status == 200 && d.ok) {
          this.uploaded = true;
          return;
        }
        this.uploadError = true;
        console.log("uploadRecording: Upload error (unsuccessful return code)", d);
        var e = new Error();
        sendErrorEvent({
          Source: 'app.js:uploadRecording:fetch',
          Message: 'status',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: d,
        });
      })
      .catch((e) => {
        console.log('Upload error:', e);
        this.uploading = false;
        this.uploadError = true;
        sendErrorEvent({
          Source: 'app.js:uploadRecording:fetch',
          Message: 'catch',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: e,
        });
      });
    },
    playReference: function(startTime, gain, onended) {
      this.stopReference();
      this.referenceGain = this.audioContext.createGain();
      this.referenceGain.gain.value = gain;
      this.referenceGain.connect(this.audioContext.destination);
      this.referenceMediaElement.currentTime = 0;
      this.referenceSource = this.audioContext.createMediaElementSource(this.referenceMediaElement);
      this.referenceSource.connect(this.referenceGain);
      this.referenceMediaElement.onended = onended;
      window.setTimeout(function() {
        // no way to schedule an exact start
        this.referenceMediaElement.play();
      }.bind(this), 1000*(startTime - this.audioContext.currentTime));
    },
    stopReference: function() {
      this.referenceMediaElement.pause();
      if (this.referenceSource) {
        this.referenceSource.disconnect();
        this.referenceSource = null;
      }
      if (this.referenceGain) {
        this.referenceGain.disconnect();
        this.referenceGain = null;
      }
    },
    setupMedia: function() {
      // Chromium only allows initialization after a user input:
      this.audioContext = new AudioContext();

      // Safari does not seem to support this...
      if (!this.audioContext.decodeAudioData) {
        this.mediaError = true;
        return;
      }
      var constraints = {
        audio: {},
      };
      var supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
      console.log(supportedConstraints);
      if (supportedConstraints.autoGainControl) {
        constraints.audio.autoGainControl = false;
      }
      if (supportedConstraints.noiseSuppression) {
        constraints.audio.noiseSuppression = false;
      }
      if (!/Chrome.* Mobile/.test(navigator.userAgent)) {
        // at least in Chrome 81/Android, setting these options
        // leads to empty recordings.
        if (supportedConstraints.echoCancellation) {
          constraints.audio.echoCancellation = false;
        }
      }
      if (this.project.WantVideo && this.videoSupported && this.useVideo) {
        constraints.video = {
          width: { min: 120, max: 720, },
          height: { min: 120, max: 720, },
          frameRate: { ideal: 25, max: 30, },
          facingMode: { ideal: 'user', },
        };
      };
      console.log("using constaints:", constraints);
      navigator.mediaDevices.getUserMedia(constraints)
        .then(this.onMedia)
        .catch(function(e) {
          console.log("first getUserMedia call failed:", e);
          sendErrorEvent({
            Source: 'app.js:setupMedia',
            Message: 'getUserMedia:first',
            URI: e.fileName,
            Line: e.lineNumber,
            Column: e.columnNumber,
            ErrorObject: {
              error: e,
              constaints: constraints,
            },
          });
          this.videoSupported = false;
          constaints = {audio: true};
          navigator.mediaDevices.getUserMedia(constraints)
            .then(this.onMedia)
            .catch(function(e) {
              console.log("second getUserMedia call failed:", e);
              this.mediaError = true;
              sendErrorEvent({
                Source: 'app.js:setupMedia',
                Message: 'getUserMedia:second',
                URI: e.fileName,
                Line: e.lineNumber,
                Column: e.columnNumber,
                ErrorObject: {
                  error: e,
                  constaints: constraints,
                },
              });
            }.bind(this));
        }.bind(this));
    },
    loadReference: function() {
      var audio = new Audio();
      audio.addEventListener('canplaythrough', function() {
        this.referenceMediaElement = audio;
      }.bind(this));
      audio.addEventListener('error', function(e) {
        console.log("loadReference failed:", e);
        sendErrorEvent({
          Source: 'app.js:loadReference',
          Message: 'onerror',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: e,
        });
        this.loadReferenceError = true;
      });
      audio.src = this.project.ReferenceURI;
    },
    loadProject: function() {
      fetch('/api/project/' + this.$route.params.project_key)
      .then(async (d) => {
        if (d && d.status == 200 && d.ok) {
          this.project = await d.json();
          return;
        }
        console.error("Failed to load project", d);
        var e = new Error();
        sendErrorEvent({
          Source: 'app.js:loadProject:fetch',
          Message: 'status',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: {
            status: d.status,
            ok: d.ok,
            body: await d.body,
          },
        });
      })
      .catch(async (e) => {
        console.error('Failed to load project', e);
        sendErrorEvent({
          Source: 'app.js:loadProject:fetch',
          Message: 'catch',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: e,
        });
      });
    },
    checkVideoSupport: function() {
      if (!navigator.mediaDevices) return false;
      if (!navigator.mediaDevices.enumerateDevices) return false;
      navigator.mediaDevices.enumerateDevices().then(function(devices) {
        devices.forEach(function(device) {
          if (device.kind == 'videoinput') {
            this.videoSupported = true;
            this.useVideo = true;
          }
        }.bind(this))
      }.bind(this));
    },
  },
  mounted: function() {
    this.loadProject();
    this.checkVideoSupport();
  },
  watch: {
    'project.Ensemble': function() {
      this.$emit('ensemble-update', this.project.Ensemble);
    },
    'delay': function() {
      this.playing = true;
      this.playRecorded();
    },
    'step': function() {
      if (this.step != 2) return;
      if (this.mediaStream !== null) return;
      this.setupMedia();
      this.loadReference();
    },
  },
}

const routes = [
  { name: 'Index', path: '/', component: Index },
  { name: 'Project', path: '/p/:project_key', component: Project },
]

const router = new VueRouter({
  mode: "history",
  routes
})


const app = new Vue({
  router,
  vuetify: new Vuetify({
    theme: {
      themes: {
        light: {
          primary: '#F57C00',
          secondary: '#78909C',
          accent: '#D84315',
        },
      },
    },
  }),
  template: '#app-template',
  data: function() {
    return {
      ensemble: '',
			aboutDialog: false,
    };
  },
  methods: {
    setEnsemble: function(e) {
      this.ensemble = e;
    },
  },
}).$mount('#app');

Vue.component('delay-arrow', {
  template: '#delay-arrow-template',
  props: ['direction', 'fast'],
});
