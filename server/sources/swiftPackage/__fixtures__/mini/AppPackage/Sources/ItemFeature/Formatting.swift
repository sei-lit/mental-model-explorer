import Foundation

struct Formatting {
    /* コメント { の中の括弧 /* 入れ子 } */ } */
    let greeting = "He said \("a } b") and { \(1 + 2)"
    let raw = #"{ "quoted" \(not interpolated) }"#
    let text = """
        }}} 複数行 \(String(describing: "}"))
        """

    func afterStrings() -> Int {
        1
    }
}
