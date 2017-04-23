package yak.message;

/**
 * @deprecated
 * @see Message
 */
public class State extends Message {

    public State() {
        status = "nominal";
    }

    public State(final String name) {
        this.status = name;
    }

    public final String status;

    public final String type = "state";

}
