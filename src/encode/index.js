/**
 * Encoder main module.
 * @module webm/encode
 */

import React from "react";
import {Paper, RaisedButton, LinearProgress, ClearFix} from "material-ui";
import Log from "./log";
import {ShowHide} from "../util";

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
  left: {
    float: "left",
    width: "50%",
  },
  right: {
    float: "left",
    width: "50%",
    textAlign: "right",
  },
  bigButton: {
    width: 450,
    marginBottom: 10,
  },
};

export default React.createClass({
  getInitialState: function() {
    return {};
  },
  handleCancelClick: function() {
    // FIXME(Kagami): Kill workers, cleanup, etc.
    this.props.onCancel();
  },
  handleLogClick: function() {
    this.setState({logShown: !this.state.logShown});
  },
  render: function() {
    let logLabel = this.state.logShown ? "hide log" : "show log";
    return (
      <Paper>
        <div style={styles.header}>encoding {this.props.source.name}: 30%</div>
        <div style={styles.controls}>
          <LinearProgress
            mode="determinate"
            value={30}
            style={styles.progress}
          />
          <ClearFix>
            <div style={styles.left}>
              <RaisedButton
                primary
                onClick={this.handleCancelClick}
                style={styles.bigButton}
                label="stop encoding"
              />
              <RaisedButton
                onClick={this.handleLogClick}
                style={styles.bigButton}
                label={logLabel}
              />
            </div>
            <div style={styles.right}>
              <RaisedButton
                style={styles.bigButton}
                label="download"
                primary
                disabled
              />
              <RaisedButton
                style={styles.bigButton}
                label="preview"
                disabled
              />
            </div>
          </ClearFix>
          <ShowHide show={this.state.logShown} viaCSS>
            <Log/>
          </ShowHide>
        </div>
      </Paper>
    );
  },
});
