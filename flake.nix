{
  description = "Du Bois Out Loud development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            pnpm
            flyctl
            gh
            # sharp builds against libvips rather than downloading a prebuilt
            # binary, which would not run on NixOS.
            vips
            pkg-config
          ];

          shellHook = ''
            echo "Du Bois Out Loud"
            echo "Node: $(node --version)  pnpm: $(pnpm --version)"
            echo ""
            echo "  pnpm install     - install dependencies"
            echo "  pnpm dev         - dev server"
            echo "  pnpm build       - build dist/"
            echo "  pnpm test        - run the test suite"
            echo "  pnpm check       - astro check (types + schema)"
            echo ""
          '';
        };
      }
    );
}
