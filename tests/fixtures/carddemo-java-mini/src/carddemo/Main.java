package carddemo;

import java.util.Arrays;

/** The one entry point of the CardDemo batch monolith: `carddemo.Main <JOB>`, environment per the job's runtime contract. */
public final class Main {
    private Main() { }

    public static void main(String[] args) {
        String job = args.length > 0 ? args[0] : "";
        String[] rest = args.length > 0 ? Arrays.copyOfRange(args, 1, args.length) : args;
        switch (job) {
            case "INTCALC" -> Intcalc.main(rest);
            case "READCUST" -> Cbcus01c.main(rest);
            default -> {
                System.err.println("usage: carddemo.Main INTCALC|READCUST");
                System.exit(2);
            }
        }
    }
}
