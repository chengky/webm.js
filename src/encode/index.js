/**
 * Encoder main module.
 * @module webm/encode
 */

import React from "react";
import {Pool, showTime} from "../ffmpeg";
import {Paper, RaisedButton, LinearProgress} from "../theme";
import Logger from "./logger";
import Preview from "./preview";
import {
  ahas, getopt, clearopt, fixopt, range, str2ab,
  MIN_VTHREADS, MAX_VTHREADS, DEFAULT_VTHREADS,
  showSize, showNow,
} from "../util";

const styles = {
  header: {
    paddingTop: 8,
    paddingLeft: 8,
    color: "#e0e0e0",
    fontWeight: 500,
    fontSize: "18px",
    textTransform: "uppercase",
  },
  progress: {
    margin: "4px 0 20px 0",
  },
  controls: {
    padding: "16px 24px",
  },
  buttons: {
    marginBottom: 10,
  },
  bigButton: {
    width: 298,
    marginRight: 9,
  },
  lastBigButton: {
    width: 298,
  },
};

export default React.createClass({
  getInitialState: function() {
    return {};
  },
  componentWillMount: function() {
    let pool = this.pool = new Pool();
    // NOTE(Kagami): We analyze various video/audio settings and create
    // jobs based on single options line passed from the `Params`
    // component. This is a bit hackish - better to use values of UI
    // widgets, but since we also support raw FFmpeg options it's the
    // only way to detect features of the new encoding.
    const params = this.props.params;
    const burnSubs = /\bsubtitles=/.test(getopt(params, "-vf", ""));
    const audio = !ahas(params, "-an");
    let vthreads = 1; //+getopt(params, "-threads");
    // FIXME(Kagami): Split in parts; do not spawn more threads than
    // number of seconds in resulting video.
    if (!Number.isInteger(vthreads) ||
        vthreads < MIN_VTHREADS ||
        vthreads > MAX_VTHREADS) {
      // We may raise an error here instead of fixing it.
      vthreads = DEFAULT_VTHREADS;
    }
    const source = this.props.source;
    const subFont = this.props.subFont;
    const safeSource = {name: source.safeName, data: source.data, keep: true};
    const videoSources = burnSubs ? [safeSource, subFont] : [safeSource];
    const commonParams = this.getCommonParams(params);
    const videoParams1 = this.getVideoParamsPass1(commonParams);
    const videoParams2 = this.getVideoParamsPass2(commonParams);
    const audioParams = this.getAudioParams(commonParams);
    const muxerParams = this.getMuxerParams({audio});
    const concatList = this.getConcatList({vthreads});

    // Logging routines.
    let logsList = [];
    let logsHash = {};
    function addLog(key) {
      const item = {key, contents: ""};
      logsList.push(item);
      logsHash[key] = item;
    }
    // TODO(Kagami): Truncate large logs?
    // TODO(Kagami): Colorize logs with hljs or manually?
    const log = (key, line) => {
      logsHash[key].contents += line + "\n";
      this.setState({logs: logsList});
    };
    const mainKey = "Main log";
    function logMain(line) {
      log(mainKey, "[" + showNow() + "] " + line);
    }
    function getCmd(opts) {
      return "$ ffmpeg " + opts.join(" ");
    }

    const start = new Date().getTime();
    let jobs = [];
    addLog(mainKey);
    logMain("Spawning jobs:");
    logMain("  " + vthreads + " video thread(s)");
    if (audio) logMain("  1 audio thread");

    range(vthreads, 1).forEach(i => {
      const key = "Video " + i;
      const logThread = log.bind(null, key);
      addLog(key);
      logMain(key + " started first pass");
      logThread(getCmd(videoParams1));
      const job = pool.spawnJob({
        params: videoParams1,
        onLog: logThread,
        files: videoSources,
      }).then(files => {
        logMain(key + " finished first pass");
        logMain(key + " started second pass");
        const namedVideoParams2 = videoParams2.concat(i + ".webm");
        logThread(getCmd(namedVideoParams2));
        return pool.spawnJob({
          params: namedVideoParams2,
          onLog: logThread,
          // Log and source for the second pass.
          files: videoSources.concat(files),
        });
      }).then(files => {
        logMain(key + " finished second pass");
        return files[0];
      }).catch(e => {
        e.key = key;
        throw e;
      });
      jobs.push(job);
    });
    if (audio) {
      const key = "Audio";
      const logThread = log.bind(null, key);
      addLog(key);
      logMain(key + " started");
      logThread(getCmd(audioParams));
      const job = pool.spawnJob({
        params: audioParams,
        onLog: logThread,
        files: [safeSource],
      }).then(files => {
        logMain(key + " finished");
        return files[0];
      }).catch(e => {
        e.key = key;
        throw e;
      });
      jobs.push(job);
    }
    const muxerKey = "Muxer";
    addLog(muxerKey);

    Promise.all(jobs).then(parts => {
      // TODO(Kagami): Skip this step if vthreads=1 and audio=false?
      logMain("Muxer started");
      const logThread = log.bind(null, muxerKey);
      logThread(getCmd(muxerParams));
      return pool.spawnJob({
        params: muxerParams,
        onLog: logThread,
        files: parts.concat(concatList),
      });
    }).then(files => {
      // TODO(Kagami): Print output duration.
      logMain("Muxer finished");
      const output = files[0];
      const elapsed = (new Date().getTime() - start) / 1000;
      log(mainKey, "==================================================");
      log(mainKey, "All is done in " + showTime(elapsed));
      log(mainKey, "Output file size: " + showSize(output.data.byteLength));
      log(mainKey, "Output video bitrate: " + getopt(params, "-b:v", "0"));
      log(mainKey, "Output audio bitrate: " + getopt(params, "-b:a", "0"));
      this.setState({output});
    }, e => {
      pool.destroy();
      let msg = "Fatal error";
      if (e.key) msg += " at " + e.key;
      msg += ": " + e.message;
      logMain(msg);
      this.setState({error: e});
    });
  },
  componentWillUnmount: function() {
    clearTimeout(this.timeout);
    this.pool.destroy();
  },
  /**
   * Return pretty filename based on the input video name.
   * in.mkv -> in.webm
   * in.webm -> in.webm.webm
   */
  getOutputFilename: function() {
    const name = this.props.source.name;
    let basename = name;
    const dotIndex = name.lastIndexOf(".");
    if (dotIndex !== -1) {
      const ext = name.slice(dotIndex + 1);
      if (ext !== "webm") basename = name.slice(0, dotIndex);
    }
    // TODO(Kagami): Use ss/t times in name, see webm.py.
    return basename + ".webm";
  },
  getCommonParams: function(params) {
    params = clearopt(params, "-threads");
    params = ["-hide_banner"].concat(params);
    return params;
  },
  getVideoParamsPass1: function(params) {
    params = params.concat("-an");
    // NOTE(Kagami): First pass will use default `-speed` value if it's
    // omitted in params. This may be considered as feature.
    params = fixopt(params, "-speed", "4");
    params = params.concat("-pass", "1", "-f", "null", "-");
    return params;
  },
  getVideoParamsPass2: function(params) {
    // Name should be calculated for each part separately.
    params = params.concat("-an", "-pass", "2");
    return params;
  },
  getAudioParams: function(params) {
    // Remove video-only options to avoid warnings.
    params = clearopt(params, "-speed");
    params = clearopt(params, "-auto-alt-ref");
    params = clearopt(params, "-lag-in-frames");
    params = params.concat("-vn", "audio.webm");
    return params;
  },
  getMuxerParams: function({audio}) {
    let params = ["-hide_banner", "-f", "concat", "-i", "list.txt"];
    if (audio) params = params.concat("-i", "audio.webm");
    params = params.concat("-c", "copy", "out.webm");
    return params;
  },
  getConcatList: function({vthreads}) {
    const list = range(vthreads, 1).map(i => {
      return "file '" + i + ".webm'";
    });
    return {
      name: "list.txt",
      data: str2ab(list.join("\n")),
    };
  },
  getCancelLabel: function() {
    return this.state.waitingConfirm
      ? "sure?"
      : (this.state.output || this.state.error) ? "back" : "cancel";
  },
  handleCancelClick: function() {
    if (this.state.waitingConfirm) return this.props.onCancel();
    this.setState({waitingConfirm: true});
    this.timeout = setTimeout(() => {
      this.setState({waitingConfirm: false});
    }, 1000);
  },
  handlePreviewClick: function() {
    this.refs.preview.show();
  },
  render: function() {
    // FIXME(Kagami): Proper error handling.
    // FIXME(Kagami): Calculate progress.
    const error = !!this.state.error;
    const done = !!this.state.output;
    const progress = error ? 0 : (done ? 100 : 30); //tmp
    const outname = this.getOutputFilename();
    let header = "encoding " + outname + ": ";
    let url;
    if (error) {
      header = "error";
    } else if (done) {
      header += "done";
      const blob = new Blob([this.state.output.data]);
      url = URL.createObjectURL(blob);
    } else {
      header += progress + "%";
    }
    return (
      <Paper>
        <div style={styles.header}>{header}</div>
        <div style={styles.controls}>
          <LinearProgress
            mode="determinate"
            value={progress}
            style={styles.progress}
          />
          <div style={styles.buttons}>
            <RaisedButton
              style={styles.bigButton}
              primary={!done}
              label={this.getCancelLabel()}
              onClick={this.handleCancelClick}
            />
            <a href={url} download={outname}>
              <RaisedButton
                style={styles.bigButton}
                primary
                disabled={!done}
                label="download"
              />
            </a>
            <RaisedButton
              style={styles.lastBigButton}
              secondary
              disabled={!done}
              label="preview"
              onClick={this.handlePreviewClick}
            />
            <Preview ref="preview" url={url} />
          </div>
          <Logger logs={this.state.logs} />
        </div>
      </Paper>
    );
  },
});
