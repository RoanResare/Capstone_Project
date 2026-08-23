import { Component } from "react";
import { RecoveryScreen } from "./RecoveryScreen.jsx";

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("App render error:", error, errorInfo);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <RecoveryScreen detail={this.state.error} />
    );
  }
}
