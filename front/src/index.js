import { inspect } from "@xstate/inspect";
import React from "react";
import ReactDOM from "react-dom";
import "./index.css";
import App from "./App.tsx";
import Canvas from "./Canvas.tsx";
//import Home from './Home';
import Main from "./Main";
import reportWebVitals from "./reportWebVitals";

/*
inspect({
  // options
  url: 'https://statecharts.io/inspect', // (default)
  iframe: false // open in new window
});*/

ReactDOM.render(
  <React.StrictMode>
    <Main />
  </React.StrictMode>,
  document.getElementById("root")
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
//reportWebVitals(console.log);
