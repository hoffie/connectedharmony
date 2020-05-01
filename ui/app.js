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
      referenceAudioBuffer: null,
      referenceSource: null,
      recordedPlayer: null,
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
          // wait some time before stopping recording because playback may
          // be delayed.
          this.recordRTC.stopRecording(function() {
            if (!this.recordingAborted) {
              this.recordedBlob = this.recordRTC.getBlob();
              this.step = 3;
            }
            if (this.project.WantVideo && this.videoSupported) {
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
      this.recordedChunks = [];
      this.recordedBlob = null;
    },
    playRecorded: async function() {
      var startTime = this.audioContext.currentTime + this.startupDelay;

      this.stopRecorded();
      this.recordedPlayer = this.audioContext.createBufferSource();
      var fileReader = new FileReader();
      fileReader.onload = async function(e) {
        var arrayBuffer = e.target.result;
        this.recordedPlayer.buffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.recordedPlayer.start(startTime, this.startupDelay + this.getTimeToBeat(this.project.BeatsBeforeStart));
        this.recordedPlayer.addEventListener('ended', function() {
          console.log("recorded player ended");
          this.playing = false;
        }.bind(this));
      }.bind(this);
      fileReader.readAsArrayBuffer(this.recordedBlob);
      this.recordedPlayer.connect(this.audioContext.destination);
      this.playReference(startTime + this.delay/1000, 0.1);
    },
    stopRecorded: function() {
      if (this.recordedPlayer) {
        this.recordedPlayer.stop();
        this.recordedPlayer.disconnect();
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
      })
      .catch((e) => {
        console.log('Upload error:', e);
        this.uploading = false;
        this.uploadError = true;
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
      })
      .catch((e) => {
        console.log('Upload error:', e);
        this.uploading = false;
        this.uploadError = true;
      });
    },
    playReference: function(startTime, gain, onended) {
      this.stopReference();
      this.referenceGain = this.audioContext.createGain();
      this.referenceGain.gain.value = gain;
      this.referenceGain.connect(this.audioContext.destination);
      this.referenceSource = this.audioContext.createBufferSource();
      this.referenceSource.buffer = this.referenceAudioBuffer;
      this.referenceSource.connect(this.referenceGain);
      this.referenceSource.start(startTime);
      if (typeof onended !== undefined) {
        this.referenceSource.addEventListener('ended', onended);
      }
    },
    stopReference: function() {
      if (this.referenceSource) {
        this.referenceSource.stop();
        this.referenceSource.disconnect();
      }
      if (this.referenceGain) {
        this.referenceGain.disconnect();
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
          this.videoSupported = false;
          navigator.mediaDevices.getUserMedia({audio: true})
            .then(this.onMedia)
            .catch(function(e) {
              console.log("second getUserMedia call failed:", e);
              this.mediaError = true;
            }.bind(this));
        }.bind(this));
    },
    loadReference: async function() {
      const response = await fetch(this.project.ReferenceURI);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.referenceAudioBuffer = await audioBuffer;
    },
    loadProject: function() {
      fetch('/api/project/' + this.$route.params.project_key)
      .then(async (d) => {
        if (d && d.status == 200 && d.ok) {
          this.project = await d.json();
          return;
        }
        console.error("Failed to load project", d);
      })
      .catch(async (e) => {
        console.error('Failed to load project', e);
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
